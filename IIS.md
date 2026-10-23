# Publicar Campo multijugador en IIS

Esta versión incluye un servidor ASP.NET Core 8. **Sustituye la publicación estática anterior por la carpeta completa**, no solo por los archivos HTML y JavaScript.

## 1. Preparar el servidor

1. Instala IIS y su Consola de administración.
2. Instala la versión actualizada del **Hosting Bundle de .NET 8 para Windows**, desde [las descargas oficiales de .NET 8](https://dotnet.microsoft.com/download/dotnet/8.0). Elige Hosting Bundle, no únicamente SDK o Desktop Runtime. El paquete instala ASP.NET Core Runtime y AspNetCoreModuleV2, necesario para alojar la aplicación en IIS.
3. Si IIS se instaló después del Hosting Bundle, repara o reinstala el Hosting Bundle. Reinicia IIS cuando lo solicite la instalación.

Referencia: [Publicación de ASP.NET Core en IIS, Microsoft Learn](https://learn.microsoft.com/aspnet/core/host-and-deploy/iis/?view=aspnetcore-8.0).

## 2. Copiar la publicación

Extrae [campo-iis.zip](./campo-iis.zip) en una carpeta dedicada, por ejemplo `C:\inetpub\campo`. Su estructura es:

```text
campo/
  Campo.dll
  Campo.deps.json
  Campo.runtimeconfig.json
  web.config
  wwwroot/
    index.html
    styles.css
    game.js
    app.js
    online.js
```

Puede incluir archivos auxiliares de compilación. Configura la ruta física de IIS como `C:\inetpub\campo`, **no** como `C:\inetpub\campo\wwwroot`.

Para actualizar un sitio anterior, detén su grupo de aplicaciones, conserva una copia de la publicación anterior y reemplaza el directorio con esta publicación completa. Reinicia el grupo después de copiar. Esto termina las salas existentes; realiza futuras actualizaciones fuera de las partidas.

## 3. Configurar IIS

- Crea un grupo de aplicaciones dedicado llamado `Campo`, con **Sin código administrado**, modo **Integrado** y **Habilitar aplicaciones de 32 bits = False**.
- Mantén **Número máximo de procesos de trabajo = 1**. Las salas se mantienen en memoria: no habilites web garden, múltiples instancias ni balanceo de carga para esta versión.
- Crea o actualiza el sitio con ese grupo y la ruta física de la publicación. Configura su nombre de host, puerto y enlace HTTPS con un certificado válido.
- Da permisos de **Lectura y ejecución** sobre la carpeta a `IIS AppPool\Campo`. La aplicación no necesita escribir en disco. Si la autenticación anónima usa otra identidad, revisa también su acceso.
- Para reducir interrupciones, configura el tiempo de inactividad en 0 y programa los reciclados fuera del horario de juego. Cada reciclado elimina las salas. Evita reciclados superpuestos, que pueden repartir solicitudes entre procesos con salas diferentes.
- Si lo alojas bajo un sitio existente, utiliza una **aplicación de IIS** con su propio grupo, por ejemplo `/campo/`; no basta crear un directorio virtual estático. Las rutas de la interfaz son relativas y permiten este despliegue.
- No necesitas instalar Node.js, Python, URL Rewrite, ARR ni WebSockets. Los estados se sincronizan por peticiones HTTP al mismo sitio.

## 4. Comprobar desde dos dispositivos

1. Visita `https://tu-servidor/api/health` (o `https://tu-servidor/campo/api/health` para una subaplicación). Debe responder con `status: ok` y `service: Campo`.
2. Abre el juego y elige **Salas en línea**. Escribe un nombre y crea una sala.
3. Comparte el enlace o el código. Desde otro navegador o dispositivo, entra al mismo sitio con otro nombre y únete.
4. El anfitrión pulsa **Comenzar partida**. Confirma que el tablero empieza cerrado, que cada jugador puede abrir su salida segura y seguir jugando sin esperar a los demás.
5. Comprueba el reloj general, la expansión de las zonas vacías, las penalizaciones y la revancha. Si quieres jugar con amigos fuera de tu red, deben poder acceder al dominio y puerto configurados en IIS.

## Regenerar el paquete

En el equipo de desarrollo, con SDK .NET 8 o superior y soporte para net8.0:

```powershell
.\publish.ps1
```

El script compila en Release, comprueba los archivos, conserva la carpeta publish anterior en publish-backups y genera un ZIP con los archivos de esta versión. El ZIP contiene la raíz de la aplicación; no mezcles archivos de versiones distintas.

## Diagnóstico

- **500.19 / AspNetCoreModuleV2 no reconocido:** instala o repara el Hosting Bundle después de IIS y reinicia IIS.
- **500.30 / 500.31:** revisa el Visor de eventos de Windows. Confirma que está instalado el runtime de ASP.NET Core 8 y que el grupo permite procesos x64.
- **La página abre, pero no crea salas:** comprueba `/api/health`, que la ruta física apunte a la raíz de la publicación y que esté el nuevo web.config. Servir únicamente wwwroot deja al juego sin servidor.
- **Sala no encontrada después de una actualización o reciclado:** las salas son temporales. Crea una nueva.
- **Desconexión:** la misma pestaña intenta recuperar su sesión. Tras más de 120 segundos sin comunicación el jugador queda fuera.

La publicación fue compilada y probada con el servidor ASP.NET Core local; la instalación y validación del sitio IIS deben realizarse en el servidor de destino.

## Skee-Ball en IIS

El mismo paquete incluye el apartado **Minijuegos** y [Skee-Ball](./skeeball.html), sus recursos y las rutas `api/skee/rooms`. No necesita otro sitio, puerto ni servicio. Sustituye la publicación completa siguiendo los pasos anteriores; copiar solo la página no actualiza la lógica del servidor.

Para verificar: abre **Minijuegos → Skee-Ball**, crea una sala y únete desde otro navegador con el código. Comienza la partida, lanza desde ambos dispositivos y comprueba los puntos en la clasificación. Los enlaces relativos admiten tanto la raíz del sitio como una aplicación de IIS en una subruta.

## Tanques en IIS

La publicación incluye [Tanques](./tanks.html), sus recursos y `api/tanks/rooms`. Usa el mismo proceso ASP.NET Core, sin base de datos ni configuración WebSocket adicional. Comprueba con dos navegadores que WASD mueve, las flechas orientan y Espacio dispara, y que ambos ven los mismos impactos y puntos. Las salas y partidas activas se pierden al reciclar el proceso.


La mejora de Tanques añade [tank-motion.js](./tank-motion.js) y nuevos datos de combate en el servidor. Reemplaza el paquete completo para mantener cliente y servidor en la misma versión. Verifica la cuenta atrás, el ajuste automático de la arena, los efectos de impacto y la revancha con dos dispositivos.
