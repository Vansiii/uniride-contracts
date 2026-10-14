import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const PASAJE = ethers.parseUnits("10", 18);
const ID_RESERVA = ethers.id("reserva-1");
const HASH_PRUEBA = ethers.id("prueba-presencia-1");

async function desplegar() {
  const [admin, operador, verificador, pasajero, conductor, atacante] =
    await ethers.getSigners();
  const urc = await ethers.deployContract("UniCoin", [admin.address]);
  const escrow = await ethers.deployContract("EscrowUniRide", [
    await urc.getAddress(),
    admin.address,
  ]);

  await urc.grantRole(await urc.ROL_ACUNADOR(), operador.address);
  await escrow.grantRole(await escrow.ROL_OPERADOR(), operador.address);
  await escrow.grantRole(await escrow.ROL_VERIFICADOR(), verificador.address);
  await urc
    .connect(operador)
    .acunar(pasajero.address, ethers.parseUnits("100", 18));

  return {
    urc,
    escrow,
    admin,
    operador,
    verificador,
    pasajero,
    conductor,
    atacante,
  };
}

/** Firma EIP-2612 del pasajero autorizando al escrow (la hace su llave en KMS en producción). */
async function firmarPermiso(
  urc: Awaited<ReturnType<typeof desplegar>>["urc"],
  dueno: Awaited<ReturnType<typeof desplegar>>["pasajero"],
  gastador: string,
  monto: bigint,
) {
  const plazo = BigInt(await networkHelpers.time.latest()) + 3600n;
  const { chainId } = await ethers.provider.getNetwork();
  const firma = await dueno.signTypedData(
    {
      name: "UniCoin",
      version: "1",
      chainId,
      verifyingContract: await urc.getAddress(),
    },
    {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    {
      owner: dueno.address,
      spender: gastador,
      value: monto,
      nonce: await urc.nonces(dueno.address),
      deadline: plazo,
    },
  );
  const { v, r, s } = ethers.Signature.from(firma);
  return { plazo, v, r, s };
}

async function conReservaBloqueada() {
  const ctx = await desplegar();
  const { urc, escrow, operador, pasajero, conductor } = ctx;
  const p = await firmarPermiso(
    urc,
    pasajero,
    await escrow.getAddress(),
    PASAJE,
  );
  await escrow
    .connect(operador)
    .bloquear(
      ID_RESERVA,
      pasajero.address,
      conductor.address,
      PASAJE,
      p.plazo,
      p.v,
      p.r,
      p.s,
    );
  return ctx;
}

describe("UniCoin", function () {
  it("solo el acuñador crea saldo (los viajes no crean saldo, A-10)", async function () {
    const { urc, atacante } = await networkHelpers.loadFixture(desplegar);
    await expect(
      urc.connect(atacante).acunar(atacante.address, 1n),
    ).to.be.revertedWithCustomError(urc, "AccessControlUnauthorizedAccount");
  });
});

describe("EscrowUniRide", function () {
  describe("bloquear", function () {
    it("retiene el pasaje del pasajero con su firma", async function () {
      const { urc, escrow, pasajero } =
        await networkHelpers.loadFixture(conReservaBloqueada);
      expect(await urc.balanceOf(await escrow.getAddress())).to.equal(PASAJE);
      expect(await urc.balanceOf(pasajero.address)).to.equal(
        ethers.parseUnits("90", 18),
      );
      const reserva = await escrow.reservas(ID_RESERVA);
      expect(reserva.estado).to.equal(1n); // Bloqueada
    });

    it("es idempotente: la misma reserva no se bloquea dos veces", async function () {
      const { urc, escrow, operador, pasajero, conductor } =
        await networkHelpers.loadFixture(conReservaBloqueada);
      const p = await firmarPermiso(
        urc,
        pasajero,
        await escrow.getAddress(),
        PASAJE,
      );
      await expect(
        escrow
          .connect(operador)
          .bloquear(
            ID_RESERVA,
            pasajero.address,
            conductor.address,
            PASAJE,
            p.plazo,
            p.v,
            p.r,
            p.s,
          ),
      ).to.be.revertedWithCustomError(escrow, "ReservaExistente");
    });

    it("rechaza bloquear sin el rol de operador", async function () {
      const { urc, escrow, pasajero, conductor, atacante } =
        await networkHelpers.loadFixture(desplegar);
      const p = await firmarPermiso(
        urc,
        pasajero,
        await escrow.getAddress(),
        PASAJE,
      );
      await expect(
        escrow
          .connect(atacante)
          .bloquear(
            ID_RESERVA,
            pasajero.address,
            conductor.address,
            PASAJE,
            p.plazo,
            p.v,
            p.r,
            p.s,
          ),
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("rechaza mover más de lo que el pasajero firmó", async function () {
      const { urc, escrow, operador, pasajero, conductor } =
        await networkHelpers.loadFixture(desplegar);
      const p = await firmarPermiso(
        urc,
        pasajero,
        await escrow.getAddress(),
        PASAJE,
      );
      await expect(
        escrow
          .connect(operador)
          .bloquear(
            ID_RESERVA,
            pasajero.address,
            conductor.address,
            PASAJE * 2n,
            p.plazo,
            p.v,
            p.r,
            p.s,
          ),
      ).to.be.revertedWithCustomError(urc, "ERC20InsufficientAllowance");
    });
  });

  describe("liberar", function () {
    it("paga al conductor y guarda el hash de la prueba", async function () {
      const { urc, escrow, verificador, conductor } =
        await networkHelpers.loadFixture(conReservaBloqueada);
      await expect(escrow.connect(verificador).liberar(ID_RESERVA, HASH_PRUEBA))
        .to.emit(escrow, "PagoLiberado")
        .withArgs(ID_RESERVA, conductor.address, PASAJE, HASH_PRUEBA);
      expect(await urc.balanceOf(conductor.address)).to.equal(PASAJE);
      expect((await escrow.reservas(ID_RESERVA)).hashPrueba).to.equal(
        HASH_PRUEBA,
      );
    });

    it("ataque A-09: una cuenta sin rol verificador no puede liberar", async function () {
      const { escrow, operador, atacante } =
        await networkHelpers.loadFixture(conReservaBloqueada);
      for (const cuenta of [atacante, operador]) {
        await expect(
          escrow.connect(cuenta).liberar(ID_RESERVA, HASH_PRUEBA),
        ).to.be.revertedWithCustomError(
          escrow,
          "AccessControlUnauthorizedAccount",
        );
      }
    });

    it("ataque A-09: no se cobra dos veces la misma reserva", async function () {
      const { escrow, verificador } =
        await networkHelpers.loadFixture(conReservaBloqueada);
      await escrow.connect(verificador).liberar(ID_RESERVA, HASH_PRUEBA);
      await expect(
        escrow.connect(verificador).liberar(ID_RESERVA, HASH_PRUEBA),
      ).to.be.revertedWithCustomError(escrow, "ReservaNoBloqueada");
      await expect(
        escrow.connect(verificador).reembolsar(ID_RESERVA, 10_000),
      ).to.be.revertedWithCustomError(escrow, "ReservaNoBloqueada");
    });

    it("ataque A-09: no se libera una reserva que nunca se bloqueó", async function () {
      const { escrow, verificador } =
        await networkHelpers.loadFixture(conReservaBloqueada);
      await expect(
        escrow
          .connect(verificador)
          .liberar(ethers.id("reserva-inexistente"), HASH_PRUEBA),
      ).to.be.revertedWithCustomError(escrow, "ReservaNoBloqueada");
    });
  });

  describe("reembolsar (D-18)", function () {
    const casos = [
      {
        nombre:
          "100 % al pasajero (cancela con > 30 min, o cancela el conductor)",
        bps: 10_000,
        pasajero: "100",
        conductor: "0",
      },
      {
        nombre: "50 % / 50 % (el pasajero cancela con < 30 min)",
        bps: 5_000,
        pasajero: "95",
        conductor: "5",
      },
    ];
    for (const caso of casos) {
      it(caso.nombre, async function () {
        const { urc, escrow, verificador, pasajero, conductor } =
          await networkHelpers.loadFixture(conReservaBloqueada);
        await escrow.connect(verificador).reembolsar(ID_RESERVA, caso.bps);
        expect(await urc.balanceOf(pasajero.address)).to.equal(
          ethers.parseUnits(caso.pasajero, 18),
        );
        expect(await urc.balanceOf(conductor.address)).to.equal(
          ethers.parseUnits(caso.conductor, 18),
        );
        expect(await urc.balanceOf(await escrow.getAddress())).to.equal(0n);
      });
    }

    it("rechaza un porcentaje mayor a 100 %", async function () {
      const { escrow, verificador } =
        await networkHelpers.loadFixture(conReservaBloqueada);
      await expect(
        escrow.connect(verificador).reembolsar(ID_RESERVA, 10_001),
      ).to.be.revertedWithCustomError(escrow, "PorcentajeInvalido");
    });

    it("ataque A-09: una cuenta sin rol verificador no puede reembolsar", async function () {
      const { escrow, atacante } =
        await networkHelpers.loadFixture(conReservaBloqueada);
      await expect(
        escrow.connect(atacante).reembolsar(ID_RESERVA, 10_000),
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount",
      );
    });
  });
});
