// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title UniCoin (URC)
/// @notice Token de UniRide. Solo red de prueba: 1 URC = 1 Bs simulado.
/// @dev Permit (EIP-2612) deja que el usuario autorice con su firma y el relayer pague el gas.
contract UniCoin is ERC20, ERC20Permit, AccessControl {
    /// Rol del relayer del backend: acuña en recargas y subsidios.
    bytes32 public constant ROL_ACUNADOR = keccak256("ROL_ACUNADOR");

    constructor(
        address administrador
    ) ERC20("UniCoin", "URC") ERC20Permit("UniCoin") {
        _grantRole(DEFAULT_ADMIN_ROLE, administrador);
    }

    /// @notice Acredita saldo nuevo (recarga o subsidio). Los viajes nunca acuñan.
    function acunar(
        address destino,
        uint256 monto
    ) external onlyRole(ROL_ACUNADOR) {
        _mint(destino, monto);
    }
}
