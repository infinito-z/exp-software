# Software del experimento (con guías vs sin guías), sesión remota

Aplicación web que conduce toda la sesión: consentimiento → datos demográficos → instrucciones con comprobación → Aplicación 1 (ficha del caso, 10 tareas, cronómetro) → cuestionarios de la Aplicación 1 → Aplicación 2 → cuestionarios de la Aplicación 2 → cierre.

## Qué mide (respecto al experimento anterior)
- **Esfuerzo real:** el servidor guarda la hora de inicio y de fin de cada caso (tiempo medido por el sistema, no por el usuario) y la hora en que se marca cada tarea.
- **Tareas completadas:** el usuario marca cada una de las 10 tareas; se exporta cuáles marcó y en qué momento.
- **Tiempo con la pestaña oculta:** se registra cada vez que el usuario cambia de pestaña (indicador de distracción).
- **Cuestionario inmediato:** la satisfacción (16 ítems) y el UEQ+ (10 escalas) se responden justo después de cada aplicación, con orden aleatorio de ítems y de escalas.
- **Calidad de las respuestas:** una pregunta de comprensión de instrucciones, 2 controles de atención, tiempo por página y aviso cuando se responde demasiado rápido.
- **Neutralidad:** los participantes solo ven "Aplicación 1" y "Aplicación 2"; nunca "con guías" ni "sin guías".
- **Asignación:** minimización aleatoria. Cada nueva sesión recibe al azar el perfil con menos sesiones válidas, así que cada bloque de 4 contiene los 4 perfiles y 20 sesiones válidas dan 5 por perfil. Las sesiones anuladas no cuentan. Los perfiles son los de la Tabla 3 del artículo.

## Poner en marcha en Railway
1. Sube esta carpeta a un repositorio de GitHub (sin `node_modules`; ya está en `.gitignore`).
2. En Railway: *New Project → Deploy from GitHub repo*, y elige el repositorio.
3. En el mismo proyecto: *New → Database → PostgreSQL*. Railway crea `DATABASE_URL`; enlázala al servicio de la aplicación (Variables → *Add reference*).
4. En Variables del servicio agrega `ADMIN_KEY`, `URL_CG` y `URL_SG` (ver `.env.example`).
5. En *Settings → Networking* genera el dominio público. Ese enlace es el que compartes con los participantes.
6. El panel del investigador está en `/admin.html` (pide la clave `ADMIN_KEY`).

Revisa los costos vigentes de Railway en su sitio antes de contratar.

## Antes de usarlo con participantes (pendientes de configuración)
Al arrancar, el servidor lista en consola lo que falta. Se edita en `config/`:
- `config/cases.json`: severidad, frecuencia y duración de cada síntoma; departamento y distrito del propietario; paciente que tiene historial para la tarea 10. Estos datos deben ser los mismos con los que se obtuvo el resultado esperado (96.0 % y 99.8 %).
- `config/config.json`: textos del consentimiento y de las instrucciones, límite sugerido de tiempo, y los perfiles.
- `URL_CG` y `URL_SG`: enlaces de las dos aplicaciones.
- Verifica que ambas aplicaciones se puedan mostrar dentro de la página (iframe). Si no, el participante usa el enlace "Abrir en una pestaña nueva" (el tiempo igual se mide, pero el registro de pestaña oculta pierde sentido). El enlace de Figma se convierte automáticamente a `embed.figma.com`; pruébalo con el prototipo real.
- Verifica que **las 10 tareas se pueden completar en el prototipo de Figma**; si alguna no existe en el prototipo, el tiempo y las tareas completadas no serán comparables.

## Datos
Desde `/admin.html` se descargan (solo sesiones completas): `satisfaccion_CG.csv`, `satisfaccion_SG.csv`, `demografico.csv`, `registro_sesiones.csv` (con esfuerzo en minutos de cada versión), `tareas.csv`, `eventos.csv` y `sesiones_completas.json`. Los primeros cuatro tienen el mismo formato que los de Google Forms y funcionan con `analisis_validacion.py` (ya acepta `.csv` en `--registro`):

    python analisis_validacion.py --cg satisfaccion_CG.csv --sg satisfaccion_SG.csv --dem demografico.csv --registro registro_sesiones.csv --out salida

Para anular una sesión (falla técnica, abandono) usa el botón *Anular* del panel; el código no se reutiliza y el siguiente participante recibe el perfil que quedó incompleto.

## Probar en local
    npm install
    ADMIN_KEY=test URL_CG=http://localhost:4001/cg.html URL_SG=http://localhost:4001/sg.html node server.js
Sin `DATABASE_URL` guarda en `data/sessions.json` (solo para pruebas). `npm test` ejecuta una sesión completa en un navegador y 8 sesiones por API.
