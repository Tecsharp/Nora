import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ThemeToggle } from '../theme'
import Tabs from '../components/Tabs'
import TopBar from '../components/TopBar'

const UPDATED = '27 de octubre de 2026'

function Terms() {
  return (
    <>
      <h1>Términos y condiciones de uso</h1>
      <p className="muted small">Última actualización: {UPDATED}</p>
      <h2>1. Qué es Nora</h2>
      <p>Nora permite crear salas temporales para compartir archivos, notas y texto con otras personas. Al crear una cuenta o usar el servicio aceptas estos términos.</p>
      <h2>2. Tu cuenta</h2>
      <ul>
        <li>Debes facilitar datos veraces y mantener tu contraseña en secreto. Eres responsable de la actividad de tu cuenta.</li>
        <li>Tras varios intentos fallidos de acceso la cuenta se bloquea temporalmente por seguridad.</li>
        <li>Un administrador puede modificar tus límites o desactivar tu cuenta si incumples estos términos.</li>
      </ul>
      <h2>3. Salas temporales: tu contenido no es permanente</h2>
      <p>Cada sala tiene una duración. Cuando expira, o cuando se cierra, se eliminan de forma definitiva sus archivos, carpetas, notas y portapapeles. <strong>Descarga lo que quieras conservar antes de que termine la sala.</strong> Nora no es un servicio de copia de seguridad.</p>
      <h2>4. Uso aceptable</h2>
      <p>No puedes usar Nora para:</p>
      <ul>
        <li>Almacenar o compartir contenido ilegal, o que vulnere derechos de autor o de terceros.</li>
        <li>Distribuir malware o intentar acceder sin autorización a cuentas, salas o sistemas.</li>
        <li>Acosar, amenazar o suplantar a otras personas.</li>
        <li>Saturar el servicio o eludir sus límites de uso, cuotas y medidas de seguridad.</li>
      </ul>
      <h2>5. Tu contenido y tu responsabilidad</h2>
      <p>Conservas todos los derechos sobre lo que subes. Eres el único responsable de ese contenido y de compartirlo solo con quien corresponda: cualquier participante de una sala puede ver y descargar sus archivos y notas.</p>
      <h2>6. Límites y cuotas</h2>
      <p>Tu cuenta tiene límites de almacenamiento, tamaño de archivo, duración y número de salas, que puede ajustar el administrador de esta instancia.</p>
      <h2>7. Disponibilidad y garantías</h2>
      <p>El servicio se ofrece «tal cual», sin garantía de disponibilidad continua ni de ausencia de errores. Pueden producirse interrupciones por mantenimiento o fallos.</p>
      <h2>8. Limitación de responsabilidad</h2>
      <p>En la medida permitida por la ley, el operador de esta instancia no responde por pérdidas de datos, lucro cesante ni daños indirectos derivados del uso del servicio.</p>
      <h2>9. Cambios</h2>
      <p>Estos términos pueden actualizarse. Los cambios relevantes se publicarán en esta página con su fecha.</p>
      <h2>10. Contacto</h2>
      <p>Para cualquier consulta, contacta con el administrador de esta instancia de Nora.</p>
    </>
  )
}

function Privacy() {
  return (
    <>
      <h1>Política de privacidad</h1>
      <p className="muted small">Última actualización: {UPDATED}</p>
      <p>Nora está pensada para recoger lo mínimo imprescindible. No usamos analítica, publicidad ni servicios de terceros para rastrearte.</p>
      <h2>Qué datos tratamos</h2>
      <ul>
        <li><strong>Cuenta:</strong> tu nombre visible, tu correo electrónico y tu contraseña (guardada únicamente como hash BCrypt, nunca en claro).</li>
        <li><strong>Contenido de las salas:</strong> archivos, carpetas, notas y textos del portapapeles que tú subes o escribes.</li>
        <li><strong>Actividad en la sala:</strong> a qué salas perteneces y si estás conectado en este momento (solo en memoria mientras dura la conexión).</li>
        <li><strong>Registros técnicos:</strong> el servidor puede guardar la dirección IP, la fecha y la ruta solicitada para seguridad y para limitar abusos.</li>
      </ul>
      <h2>Para qué los usamos</h2>
      <ul>
        <li>Autenticarte y mantener tu sesión.</li>
        <li>Mostrar la sala a sus participantes y entregar el contenido en tiempo real.</li>
        <li>Proteger el servicio frente a accesos no autorizados y abusos.</li>
      </ul>
      <p>No vendemos ni cedemos tus datos a terceros, ni los usamos para perfilarte.</p>
      <h2>Cookies y almacenamiento del navegador</h2>
      <ul>
        <li><strong>Cookie de sesión (<code>nora_refresh</code>):</strong> estrictamente necesaria. Es HttpOnly, SameSite=Strict y se marca Secure cuando accedes por HTTPS. Sin ella no puedes mantener la sesión.</li>
        <li><strong>Preferencias locales:</strong> tu tema (claro/oscuro) y, para reanudar subidas interrumpidas, una referencia al archivo en el almacenamiento del navegador. Permanecen en tu dispositivo.</li>
      </ul>
      <p>Como solo usamos cookies técnicas imprescindibles, no se muestra un aviso de consentimiento.</p>
      <h2>Quién puede ver tu contenido</h2>
      <ul>
        <li>Las personas que participan en la misma sala.</li>
        <li>El operador de esta instancia, que administra el servidor y las cuentas. El contenido <strong>no está cifrado de extremo a extremo</strong>, así que el operador puede técnicamente acceder al almacenamiento.</li>
      </ul>
      <h2>Tus derechos</h2>
      <p>Puedes pedir acceso, rectificación o eliminación de tus datos, y oponerte a su tratamiento, contactando con el administrador de esta instancia. Puedes borrar tus archivos y notas en cualquier momento desde la sala.</p>
      <h2>Menores</h2>
      <p>Nora no está dirigido a menores de 14 años.</p>
    </>
  )
}

function DataHandling() {
  return (
    <>
      <h1>Manejo de los datos</h1>
      <p className="muted small">Última actualización: {UPDATED}</p>
      <p>Así se almacenan, protegen y eliminan tus datos.</p>
      <h2>Dónde se guardan</h2>
      <ul>
        <li><strong>Base de datos PostgreSQL:</strong> cuentas, salas, notas y metadatos de archivos. Solo es accesible desde la red interna de la aplicación.</li>
        <li><strong>Almacenamiento privado de objetos (S3):</strong> el contenido de los archivos. No tiene acceso público: solo el servidor de Nora lo lee, y únicamente para participantes autenticados de la sala.</li>
      </ul>
      <h2>Cómo se protegen</h2>
      <ul>
        <li>Contraseñas con hash BCrypt y bloqueo temporal tras intentos fallidos.</li>
        <li>Sesiones con tokens de corta duración y renovación rotativa con detección de reutilización.</li>
        <li>Pasarela con límites de peticiones, cabeceras de seguridad y política CSP estricta.</li>
        <li>Los archivos se descargan siempre como adjunto y nunca se ejecutan en el navegador.</li>
        <li>Cifrado en tránsito cuando la instancia se publica con HTTPS (recomendado). El cifrado en reposo depende del disco del servidor.</li>
      </ul>
      <h2>Cuánto tiempo se conservan</h2>
      <ul>
        <li><strong>Contenido de una sala:</strong> hasta que la sala expira o se cierra; entonces se borra de forma definitiva, incluidos los archivos del almacén.</li>
        <li><strong>Archivos individuales y carpetas:</strong> hasta que alguien con permiso los borra. Al borrar una carpeta se elimina todo su contenido.</li>
        <li><strong>Subidas incompletas:</strong> se descartan automáticamente tras 24 horas sin actividad.</li>
        <li><strong>Salas sin expiración:</strong> algunas cuentas pueden tener salas sin límite de tiempo; permanecen hasta que se cierran.</li>
        <li><strong>Datos de cuenta:</strong> mientras la cuenta exista. Puedes solicitar su eliminación al administrador.</li>
      </ul>
      <h2>Copias de seguridad</h2>
      <p>Nora no realiza copias de seguridad del contenido de las salas: lo que se borra no se puede recuperar.</p>
      <div className="callout">
        Estos textos son una plantilla general. Quien despliega y opera una instancia de Nora debe revisarlos y adaptarlos a su situación y a la normativa que le aplique.
      </div>
    </>
  )
}

const PAGES: Record<string, { label: string; body: ReactNode }> = {
  terms: { label: 'Términos de uso', body: <Terms /> },
  privacy: { label: 'Privacidad', body: <Privacy /> },
  data: { label: 'Manejo de datos', body: <DataHandling /> },
}

/** Páginas legales públicas (no requieren sesión). */
export default function Legal() {
  const doc = useLocation().pathname.replace('/', '')
  const navigate = useNavigate()
  const page = PAGES[doc]
  if (!page) return <Navigate to="/terms" replace />
  return (
    <>
      <TopBar><ThemeToggle /></TopBar>
      <div className="shell">
      <main className="legal">
        <div className="legal-tabs">
          <Tabs label="Documentos legales" value={doc} onChange={(id) => navigate(`/${id}`)}
            items={Object.entries(PAGES).map(([id, p]) => ({ id, label: p.label }))} />
        </div>
        <article key={doc} className="prose card swap">{page.body}</article>
      </main>
      <footer className="site-footer"><span>© {new Date().getFullYear()} Nora</span><Link to="/">Volver a Nora</Link></footer>
      </div>
    </>
  )
}
