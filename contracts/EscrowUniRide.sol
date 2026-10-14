// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title EscrowUniRide
/// @notice Retiene el pasaje al reservar y lo resuelve una sola vez:
///         liberar (viaje verificado) o reembolsar (cancelación / expiración).
/// @dev Amenaza A-09: solo ROL_VERIFICADOR resuelve, y cada reserva se resuelve una vez.
contract EscrowUniRide is AccessControl {
    using SafeERC20 for IERC20;

    /// Relayer del backend: registra los bloqueos con la firma (permit) del pasajero.
    bytes32 public constant ROL_OPERADOR = keccak256("ROL_OPERADOR");
    /// Cuenta verificadora: única que libera o reembolsa.
    bytes32 public constant ROL_VERIFICADOR = keccak256("ROL_VERIFICADOR");

    uint16 public constant BPS_TOTAL = 10_000;

    enum Estado {
        Ninguno,
        Bloqueada,
        Liberada,
        Reembolsada
    }

    struct Reserva {
        address pagador;
        address conductor;
        uint256 monto;
        Estado estado;
        bytes32 hashPrueba;
    }

    IERC20 public immutable token;
    mapping(bytes32 idReserva => Reserva) public reservas;

    event ReservaBloqueada(
        bytes32 indexed idReserva,
        address indexed pagador,
        address indexed conductor,
        uint256 monto
    );
    event PagoLiberado(
        bytes32 indexed idReserva,
        address indexed conductor,
        uint256 monto,
        bytes32 hashPrueba
    );
    event ReservaReembolsada(
        bytes32 indexed idReserva,
        uint256 alPasajero,
        uint256 alConductor
    );

    error ReservaExistente(bytes32 idReserva);
    error ReservaNoBloqueada(bytes32 idReserva);
    error DatosInvalidos();
    error PorcentajeInvalido(uint16 porcentajePasajeroBps);

    constructor(IERC20 token_, address administrador) {
        token = token_;
        _grantRole(DEFAULT_ADMIN_ROLE, administrador);
    }

    /// @notice Retiene `monto` del pasajero para la reserva. Idempotente: una reserva no se bloquea dos veces.
    /// @dev El conductor queda fijado aquí, así el verificador no puede desviar el pago al liberar.
    ///      El permit va en try/catch: si alguien lo adelantó, la autorización ya existe y transferFrom funciona.
    function bloquear(
        bytes32 idReserva,
        address pagador,
        address conductor,
        uint256 monto,
        uint256 plazo,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyRole(ROL_OPERADOR) {
        if (reservas[idReserva].estado != Estado.Ninguno)
            revert ReservaExistente(idReserva);
        if (
            monto == 0 ||
            pagador == address(0) ||
            conductor == address(0) ||
            pagador == conductor
        ) {
            revert DatosInvalidos();
        }

        reservas[idReserva] = Reserva(
            pagador,
            conductor,
            monto,
            Estado.Bloqueada,
            bytes32(0)
        );

        try
            IERC20Permit(address(token)).permit(
                pagador,
                address(this),
                monto,
                plazo,
                v,
                r,
                s
            )
        {} catch {}
        token.safeTransferFrom(pagador, address(this), monto);

        emit ReservaBloqueada(idReserva, pagador, conductor, monto);
    }

    /// @notice Paga al conductor tras un viaje verificado y guarda el hash de la prueba de presencia.
    function liberar(
        bytes32 idReserva,
        bytes32 hashPrueba
    ) external onlyRole(ROL_VERIFICADOR) {
        Reserva storage reserva = reservas[idReserva];
        if (reserva.estado != Estado.Bloqueada)
            revert ReservaNoBloqueada(idReserva);

        reserva.estado = Estado.Liberada;
        reserva.hashPrueba = hashPrueba;
        token.safeTransfer(reserva.conductor, reserva.monto);

        emit PagoLiberado(
            idReserva,
            reserva.conductor,
            reserva.monto,
            hashPrueba
        );
    }

    /// @notice Devuelve `porcentajePasajeroBps` al pasajero y el resto al conductor (D-18).
    ///         10 000 = 100 % al pasajero; 5 000 = mitad y mitad.
    function reembolsar(
        bytes32 idReserva,
        uint16 porcentajePasajeroBps
    ) external onlyRole(ROL_VERIFICADOR) {
        if (porcentajePasajeroBps > BPS_TOTAL)
            revert PorcentajeInvalido(porcentajePasajeroBps);
        Reserva storage reserva = reservas[idReserva];
        if (reserva.estado != Estado.Bloqueada)
            revert ReservaNoBloqueada(idReserva);

        reserva.estado = Estado.Reembolsada;
        uint256 alPasajero =
            (reserva.monto * porcentajePasajeroBps) / BPS_TOTAL;
        uint256 alConductor = reserva.monto - alPasajero;
        if (alPasajero > 0) token.safeTransfer(reserva.pagador, alPasajero);
        if (alConductor > 0) token.safeTransfer(reserva.conductor, alConductor);

        emit ReservaReembolsada(idReserva, alPasajero, alConductor);
    }
}
