import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const MONTO = ethers.parseUnits("50", 18);
const ID_ORDEN = ethers.id("orden-1");

async function desplegar() {
  const [admin, relayer, pasajero, atacante] = await ethers.getSigners();
  const urc = await ethers.deployContract("UniCoin", [admin.address]);
  await urc.grantRole(await urc.ROL_ACUNADOR(), relayer.address);
  return { urc, relayer, pasajero, atacante };
}

describe("UniCoin.acunarRecarga", () => {
  it("acredita el monto y emite el evento con el id de la orden", async () => {
    const { urc, relayer, pasajero } = await desplegar();
    await expect(
      urc.connect(relayer).acunarRecarga(pasajero.address, MONTO, ID_ORDEN),
    )
      .to.emit(urc, "RecargaAcunada")
      .withArgs(ID_ORDEN, pasajero.address, MONTO);
    expect(await urc.balanceOf(pasajero.address)).to.equal(MONTO);
    expect(await urc.ordenAcunada(ID_ORDEN)).to.equal(true);
  });

  it("A-09: la misma orden no acuña dos veces, aunque cambien destino o monto", async () => {
    const { urc, relayer, pasajero, atacante } = await desplegar();
    await urc.connect(relayer).acunarRecarga(pasajero.address, MONTO, ID_ORDEN);

    await expect(
      urc.connect(relayer).acunarRecarga(pasajero.address, MONTO, ID_ORDEN),
    )
      .to.be.revertedWithCustomError(urc, "OrdenYaAcunada")
      .withArgs(ID_ORDEN);
    await expect(
      urc.connect(relayer).acunarRecarga(atacante.address, 1n, ID_ORDEN),
    ).to.be.revertedWithCustomError(urc, "OrdenYaAcunada");

    expect(await urc.totalSupply()).to.equal(MONTO);
  });

  it("órdenes distintas acuñan cada una", async () => {
    const { urc, relayer, pasajero } = await desplegar();
    await urc.connect(relayer).acunarRecarga(pasajero.address, MONTO, ID_ORDEN);
    await urc
      .connect(relayer)
      .acunarRecarga(pasajero.address, MONTO, ethers.id("orden-2"));
    expect(await urc.balanceOf(pasajero.address)).to.equal(MONTO * 2n);
  });

  it("sin ROL_ACUNADOR se revierte y la orden sigue libre", async () => {
    const { urc, atacante } = await desplegar();
    await expect(
      urc.connect(atacante).acunarRecarga(atacante.address, MONTO, ID_ORDEN),
    ).to.be.revertedWithCustomError(urc, "AccessControlUnauthorizedAccount");
    expect(await urc.totalSupply()).to.equal(0n);
    expect(await urc.ordenAcunada(ID_ORDEN)).to.equal(false);
  });

  it("el hash se recupera del evento filtrando por la orden", async () => {
    const { urc, relayer, pasajero } = await desplegar();
    const tx = await urc
      .connect(relayer)
      .acunarRecarga(pasajero.address, MONTO, ID_ORDEN);
    const [evento] = await urc.queryFilter(
      urc.filters.RecargaAcunada(ID_ORDEN),
    );
    expect(evento.transactionHash).to.equal(tx.hash);
  });
});
