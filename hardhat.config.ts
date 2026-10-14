import type { HardhatUserConfig } from "hardhat/config";
import { configVariable } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

// Solo redes de prueba (AGENTS.md §11). Nunca mainnet.
const config: HardhatUserConfig = {
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    localhost: { type: "http", url: "http://127.0.0.1:8545" },
    amoy: {
      type: "http",
      chainId: 80002,
      url: configVariable("CADENA_RPC_URL"),
      // Guardada cifrada con `npx hardhat keystore set AMOY_LLAVE_DESPLIEGUE`
      accounts: [configVariable("AMOY_LLAVE_DESPLIEGUE")],
    },
  },
};

export default config;
