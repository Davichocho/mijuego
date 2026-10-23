# Campo · Buscaminas

Interfaz en español con portada, colores personalizables, tres dificultades locales y salas multijugador en línea.

## Modos

- **En este dispositivo:** partida individual o dos jugadores por turnos. Se puede abrir [index.html](./index.html) directamente.
- **Salas en línea:** cada persona entra desde su dispositivo con nombre y código de sala. Duelo 1 vs 1 o todos contra todos, de 2 a 8 jugadores simultáneos. Requiere ejecutar el servidor incluido.

El mapa de las salas se amplía al iniciar y ajusta automáticamente todas las casillas al ancho y alto disponibles, sin marco exterior ni desplazamiento manual. «Volver a la página» o Escape restaura la vista normal sin abandonar la partida; «Ampliar mapa» vuelve a expandirla.

## Reglas de las salas

Campo compartido de 40 × 24 casillas, con 180 minas. **El tablero empieza completamente cerrado.** El servidor asigna a cada jugador una salida segura separada, marcada con una estrella en su pantalla. En su primera jugada debe pulsar esa salida: se abre su área de 3 × 3 y se expanden las casillas vacías conectadas, sin sumar puntos. Las salidas de los demás permanecen reservadas hasta su primera apertura. Las minas se fijan al iniciar; los números ya revelados nunca cambian.

Todos pueden jugar a su propio ritmo desde el inicio, sin turnos ni límite por jugada. Al abrir un espacio vacío se descubre la zona conectada y su borde numerado, como en solitario. Las banderas son privadas. Una bandera propia bloquea la apertura; las marcas de otros no bloquean una expansión compartida.

Después de la primera apertura, cada **jugada segura suma 10 puntos**, independientemente del número de casillas despejadas. Cuando coinciden varias solicitudes sobre la misma casilla, solo la primera procesada obtiene puntos. Las casillas ya abiertas no vuelven a puntuar. Encontrar una mina **resta 20 puntos** y elimina al jugador del campo, pero su puntuación final aún puede ganar.

La ronda termina al despejar el campo, vencer el tiempo general o quedar como máximo un jugador activo. Gana la **mayor puntuación final** de quienes hicieron su apertura, incluidos los eliminados por mina. Los empates se comparten. Quienes abandonan o se desconectan durante más de 120 segundos quedan fuera de la clasificación final; si nadie es elegible, no hay ganador. Pensar sin hacer jugadas no penaliza mientras se mantenga la conexión.

El anfitrión elige 3, 5, 10 o 15 minutos, o sin límite general. Este reloj comienza al iniciar la ronda. Puede preparar una revancha con el mismo código: se reinician puntos y aperturas. Al abandonar, la función de anfitrión pasa a otra persona.

## Ejecutar el servidor

Requisito de desarrollo: SDK de .NET 8 o superior con soporte para compilar net8.0; runtime ASP.NET Core 8.

```powershell
dotnet run --project server/Campo.csproj --urls http://localhost:5080
```

Abre http://localhost:5080. Para probar en una red local, utiliza una dirección accesible desde los demás dispositivos y configura el enlace y firewall del servidor. Todos deben usar el mismo servidor; las partidas no se sincronizan mediante archivos estáticos.

## Publicar en IIS

```powershell
.\publish.ps1
```

Genera [publish](./publish/) y [campo-iis.zip](./campo-iis.zip), con servidor, configuración y recursos web. Consulta [IIS.md](./IIS.md) para instalar el Hosting Bundle y configurar el sitio. La versión anterior de la carpeta de publicación se conserva en publish-backups.

## Verificación

```powershell
node --test game.test.js
dotnet run --project tests/Campo.Tests.csproj -c Release
# Con el servidor ejecutándose en http://127.0.0.1:5080:
node --test tests/http.test.js
```

La prueba HTTP admite otra dirección mediante la variable CAMPO_TEST_URL. Las pruebas del servidor controlan el reloj, las aperturas individuales, expansión, jugadas simultáneas, solicitudes duplicadas, puntuación, penalizaciones, tiempo, permisos, banderas, revancha y desconexiones.

## Funcionamiento y límites

El servidor ASP.NET Core es la autoridad: no acepta puntuaciones del navegador ni envía el contenido de las casillas ocultas. La interfaz consulta el estado aproximadamente cada segundo y envía las jugadas inmediatamente por HTTP. No requiere WebSockets, base de datos, Node.js en producción ni servicios externos.

Las salas se guardan en memoria de **un solo proceso**. Reiniciar, reciclar o volver a desplegar la aplicación elimina las salas. Hasta 200 salas por proceso, 8 personas por sala; no es una medición de capacidad de producción. Se cierran tras 30 minutos sin actividad o al cumplir 6 horas desde su creación. Los límites HTTP protegen la creación de salas y las jugadas frente a ráfagas.

La sesión se conserva en la misma pestaña al recargar. Si no se reciben solicitudes de un jugador durante más de 120 segundos, queda fuera. Cerrar una pestaña se detecta por ese plazo; salir mediante el botón notifica al servidor de inmediato. Los colores se guardan localmente. Google Fonts es opcional: el juego utiliza fuentes del sistema si no hay conexión.

## Minijuegos · Skee-Ball

Desde **Minijuegos** en la portada se accede a [Skee-Ball](./skeeball.html). Requiere el mismo servidor ASP.NET Core que las salas del Buscaminas.

- Salas privadas con código e invitación, nombres y capacidad de 2, 4 u 8 jugadores.
- Pistas independientes y juego simultáneo: nueve bolas por jugador, sin turnos.
- Ajusta la dirección con el deslizador; mantén el botón para cargar fuerza y suelta para lanzar. También funciona con táctil y con Espacio/Enter. La fuerza oscila y determina la distancia.
- Aros de 10, 20, 30, 40, 50 y 100 puntos. Fallar suma cero. El servidor calcula las puntuaciones y evita duplicar tiros repetidos.
- Rondas de 2, 3 o 5 minutos, o sin límite. Finalizan al completar todos los lanzamientos o agotarse el reloj. Gana el puntaje mayor; los empates se comparten.
- El anfitrión prepara la revancha con el mismo código. Abandonar o desconectarse más de 120 segundos excluye de la clasificación; las salas desaparecen al reiniciar el servidor.
- API independiente bajo `api/skee/rooms`; no cambia las reglas del Buscaminas. Sin base de datos ni servicios adicionales.

Pruebas del servidor: `dotnet run --project tests/Campo.Tests.csproj -c Release`. Pruebas HTTP de Skee-Ball: `node --test tests/skee-http.test.js` con el servidor iniciado (variable opcional `CAMPO_TEST_URL`).

## Minijuegos · Tanques

[Tanques](./tanks.html) permite duelos o todos contra todos de 2 a 8 jugadores con salas privadas. **WASD** mueve el tanque, las **flechas** apuntan el cañón independientemente y **Espacio** dispara (también hay controles táctiles). Cada ronda genera un laberinto conectado nuevo; las paredes bloquean vehículos y proyectiles.

Cada tanque tiene tres puntos de blindaje. Una destrucción suma una baja al atacante; el rival reaparece tras 1,5 segundos con dos segundos de protección, que pierde al disparar. Gana quien consigue cinco bajas o quien tenga más al terminar los tres minutos. Los empates se comparten. Abandonar o desconectarse 30 segundos excluye de la ronda. Si queda un solo jugador, finaliza el combate.

El servidor simula movimiento, cadencia, impactos, reapariciones y puntuaciones. El cliente envía únicamente controles y recibe el estado aproximadamente trece veces por segundo mediante HTTP durante el combate; no requiere WebSockets ni otro servicio de IIS. Los controles caducan tras 300 ms sin actualizaciones. Las salas son temporales y el anfitrión puede preparar revancha.


### Tanques: arena mejorada

- Inicio con cuenta atrás de tres segundos; conserva los tres minutos completos de combate.
- Laberintos simétricos, rutas alternativas y plaza central para facilitar los encuentros.
- Movimiento más ágil y respuesta visual inmediata con corrección al estado del servidor. El apuntado conserva también las pulsaciones breves; Espacio admite toques y disparo sostenido.
- La arena ocupa la pantalla al empezar. «Reducir» o Escape vuelven a la página sin abandonar. El campo se ajusta al espacio disponible, incluidos los controles táctiles.
- Cañón con retroceso, proyectiles con estela, chispas, explosiones, protección visible, blindaje por tanque, recarga y registro de bajas. Los eventos proceden del servidor y no modifican los puntos del cliente.
- Sonido sintetizado opcional (apagado inicialmente), pantalla de resultado y revancha. Los efectos intensos se reducen cuando el dispositivo solicita reducir el movimiento.
- Pruebas de movimiento del cliente: `node --test tests/tank-motion.test.js`. Pruebas HTTP: `node --test tests/tanks-http.test.js`.

Las pruebas HTTP de los tres juegos crean muchas salas desde la misma IP: ejecútalas con servidores independientes o separadas por la ventana de un minuto para no activar el límite de creación de salas.
# mijuego
