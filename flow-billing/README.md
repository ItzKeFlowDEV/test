# flow-billing

Facturas y multas estilo okokBilling para FiveM, con el diseño FlowDev. Funciona con **ESX**, **QBCore** y **QBox**.
Guarda en **MySQL** (oxmysql, crea las tablas solo) o, si no tienes oxmysql, en `data/bills.json`.

## Instalación
1. Copia `flow-billing` a `resources/` y pon `ensure flow-billing` en `server.cfg` (después de tu framework y de oxmysql).
2. Abre con `/facturas` o **F7** (se cambia en `config.lua` y en Ajustes > Teclas de FiveM).

## Funciones
- **Facturas universales**: cualquier jugador puede mandar una factura *Personal* a otro (`Config.Universal`). El dinero va 100% a quien la emite; si está desconectado, se le entrega al volver.
- **Facturas de trabajo**: policía, EMS, mecánico, taxi... con su marca y color (`Config.Jobs`). El dinero va a la cuenta de la empresa y quien factura cobra su **comisión**.
- **Rangos**: `minGrade` por trabajo limita quién puede emitir facturas oficiales. `bossGrade` (o jefe del framework) ve la pestaña **Empresa**.
- **Plantillas**: conceptos rápidos por trabajo (`presets`). Con `allowCustom = false` solo se pueden usar las plantillas.
- **Vencimiento y cobro automático**: cada factura vence a las `Config.AutoPay.dueHours` horas. Al vencer se cobra sola del banco.
  Si no hay fondos, suma un **recargo por hora** (`Config.LateFee.percentPerHour`, con tope `maxPercent`) hasta que se pague.
- **Empresa**: total facturado, cobrado, pendiente, buscador, filtros y **anular** facturas pendientes.
- Aviso en pantalla cuando te llega una factura nueva.
- **Recibo profesional**: empresa con nombre completo (`company`), Nº, emisión/vencimiento/estado, emisor y cliente, tabla de conceptos con recargo, subtotal y total, cuenta atrás en vivo hasta el vencimiento, código QR, código de barras y Nº de transacción, sello animado y marca de agua.
- **Pago aprobado**: animación con el número de transacción al pagar.
- **Enseñar recibo**: botón para mostrar el recibo al jugador más cercano (le aparece unos segundos en pantalla, sin quitarle el control). Sirve como comprobante de pago.

## Cuenta de la empresa
Detecta `esx_addonaccount`, `qb-banking`, `qb-management` y `Renewed-Banking`. Si usas otro banco, define `Config.AddSocietyMoney = function(society, amount) ... end`.

## Exports (servidor)
```lua
exports['flow-billing']:CreateBill(sourceEmisor, sourceCliente, 'Concepto', 500, 'nota', 'job')   -- o 'personal'
exports['flow-billing']:GetUnpaid(source)
```
