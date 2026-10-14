import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Despliega URC y el escrow. Los roles (ROL_ACUNADOR, ROL_OPERADOR, ROL_VERIFICADOR) se otorgan
// después a las direcciones de las llaves KMS del backend (SP23 / HU-12).
export default buildModule("UniRide", (m) => {
  const administrador = m.getAccount(0);
  const urc = m.contract("UniCoin", [administrador]);
  const escrow = m.contract("EscrowUniRide", [urc, administrador]);
  return { urc, escrow };
});
