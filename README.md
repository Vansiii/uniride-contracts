# Contratos de UniRide

`UniCoin` (URC) y `EscrowUniRide` — diseño en `SPECS/ssd.md` §10. **Solo redes de prueba.**

| Comando | Qué hace |
|---|---|
| `npm test` | Compila y ejecuta las pruebas (incluye ataques A-09 y A-10) |
| `npm run build` | Compila |
| `npm run lint` / `npm run format` | Verifica / aplica Prettier |
| `npm run nodo` | Nodo Hardhat local en :8545 |
| `npm run desplegar:local` | Despliega en el nodo local |
| `npm run desplegar:amoy` | Despliega en Polygon Amoy |

Para desplegar en Amoy, la llave de despliegue **nunca** va en `.env` ni en el repositorio. Se guarda cifrada en el keystore de Hardhat:

```bash
npx hardhat keystore set AMOY_LLAVE_DESPLIEGUE
npx hardhat keystore set CADENA_RPC_URL
```

Después del despliegue se otorgan los roles a las direcciones de las llaves KMS del backend: `ROL_ACUNADOR` (URC), `ROL_OPERADOR` y `ROL_VERIFICADOR` (escrow).
