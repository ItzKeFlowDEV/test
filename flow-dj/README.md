# flow-dj

Cabinas de DJ con música de **YouTube** o **MP3/WAV**, audio 3D por distancia y paneles con el diseño FlowDev. Standalone (ESX / QBCore / QBox solo para cabinas por trabajo).

## Instalación
1. Copia `flow-dj` a `resources/` y pon `ensure flow-dj` en `server.cfg`.
2. Admins: `group.admin` de txAdmin/ACE, grupos admin de ESX/QBCore/QBox, permiso `flowdj.admin` o `Config.Admins`.

## Admins · `/djadmin`
- **Nueva cabina aquí**: crea una cabina donde estás parado.
- Ajustes por cabina: nombre, posición (“Mi posición” / “Ir”), **metros que se escucha**, **volumen máximo**, distancia para abrirla,
  quién puede usarla (**todos**, **un trabajo** o **solo admins**) y si sale en el mapa.
- Mientras editas, el radio se dibuja en el suelo del juego y en el radar del panel.
- Detener la música de una cabina o eliminarla. Las cabinas se guardan en `data/booths.json`.

## DJ · tecla **E** en la cabina
- Plato con la portada del video girando, brazo que baja al sonar, play/pausa, detener, siguiente y barra para adelantar.
- **Master** de volumen con vúmetros.
- **Cola**: pegar enlace de YouTube o .mp3/.wav → “Añadir a la cola” o “Poner ya”. Subir, quitar, poner ya, vaciar. **Historial** para volver a poner.
- El título y la portada de YouTube se sacan solos.

## Cómo se escucha
- Todos los jugadores dentro del radio la escuchan sincronizada.
- Volumen completo cerca de la cabina y se va apagando hasta el borde del radio. Se oye por el lado donde está la cabina y,
  lejos, suena más apagada (con MP3/WAV). Dentro de un vehículo se oye más bajo.
- La canción solo se carga para quien está en el radio (no gasta internet a los que están lejos).
- Tarjeta “Sonando ahora” arriba a la derecha con la canción, el DJ y a cuántos metros estás.
