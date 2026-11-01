# Calidad del código: CI, SonarQube y Coverity

Esta guía explica cómo pasar Nora por **SonarQube** y **Coverity** y cómo mostrar sus insignias en el README **sin Jenkins**: el análisis lo ejecuta **GitHub Actions**, que ya viene con el repositorio.

## Qué hay ya en el repositorio

| Archivo | Para qué |
|---|---|
| `.github/workflows/ci.yml` | **CI**: compila el backend (Maven), el frontend (TypeScript + Vite), comprueba el agente (Rust) y valida `docker-compose.yml`. Es el que da la insignia **CI passing**. |
| `.github/workflows/sonar.yml` | Análisis de **SonarQube / SonarCloud**. Se salta solo (sin fallar) hasta que añadas el secreto `SONAR_TOKEN`. |
| `sonar-project.properties` | Qué carpetas analiza Sonar (backend, frontend y agente) y qué excluye. |

## Cuándo se ejecuta

| Flujo | Cuándo |
|---|---|
| **CI** | En **cada `git push`** (cualquier rama), en cada pull request y a mano. No hay que configurar nada: GitHub lo ejecuta al subir el archivo `.github/workflows/ci.yml`. |
| **Calidad (SonarQube)** | En cada push a **`develop` o `main`**, en pull requests (solo SonarCloud) y a mano. En ramas `feature/*` no se lanza a propósito: SonarQube Community solo analiza la rama principal y una rama de trabajo la pisaría. |

Dónde verlo: pestaña **Actions** del repositorio en GitHub (verde = bien, rojo = falló; pulsa la ejecución para ver el registro). Para lanzarlo sin hacer push: **Actions → elige el flujo → Run workflow**.

> Los flujos solo se ejecutan si el archivo existe en la rama que subes. La insignia de CI del README apunta a `develop`: se pone verde cuando `develop` ya tiene `ci.yml` (al hacer merge de la rama) y se ha ejecutado una vez.

## SonarQube sin Jenkins

Sonar necesita dos cosas: **un servidor Sonar** y **alguien que ejecute el análisis y le mande el resultado**. Jenkins era esa segunda parte; aquí lo hace GitHub Actions. Elige un servidor:

### Opción A · SonarCloud (la más rápida, gratis para repositorios públicos)

1. Entra en <https://sonarcloud.io> con tu cuenta de GitHub y pulsa **Analyze new project** → elige `Tecsharp/Nora`. Elige *«With GitHub Actions»* (no *Automatic Analysis*).
2. SonarCloud te da una **organización** y una **clave de proyecto** (suele ser `Tecsharp_Nora`; si es otra, cámbiala en el README y en `sonar-project.properties`).
3. En SonarCloud: **My Account → Security → Generate token** y copia el token.
4. En GitHub: **Settings → Secrets and variables → Actions**
   - pestaña *Secrets* → **New repository secret**: `SONAR_TOKEN` = el token.
   - pestaña *Variables* → **New repository variable**: `SONAR_ORGANIZATION` = tu organización de SonarCloud (por ejemplo `tecsharp`). Si la clave del proyecto no es `Tecsharp_Nora`, añade también `SONAR_PROJECT_KEY`.
5. Haz un push a `develop` (o lanza el flujo a mano en **Actions → Calidad (SonarQube) → Run workflow**). En unos minutos aparece el análisis en SonarCloud y las insignias del README se rellenan.
6. Recomendado: en SonarCloud desactiva **Automatic Analysis** (Administration → Analysis Method) para que no se duplique con el flujo.

> SonarCloud es gratis solo con repositorios **públicos**. Para uno privado usa la opción B.

### Opción B · SonarQube propio (Community Edition, en tu servidor)

Sirve para repositorios privados y todo queda en tu infraestructura. Puedes levantarlo en el mismo servidor de Nora:

```bash
docker run -d --name sonarqube --restart unless-stopped -p 9000:9000 \
  -v sonarqube_data:/opt/sonarqube/data -v sonarqube_extensions:/opt/sonarqube/extensions \
  sonarqube:community
```

1. Abre `http://TU-SERVIDOR:9000` (usuario y contraseña iniciales `admin` / `admin`; te pide cambiarla).
2. **Create project → Manually** con la clave `Tecsharp_Nora`; método de análisis **GitHub Actions**. Genera un token (**My Account → Security**).
3. GitHub Actions tiene que **llegar** a ese servidor desde Internet: publícalo con un dominio HTTPS (por ejemplo con Cloudflare Tunnel, como ya haces con Nora). Un `localhost` no sirve desde los ejecutores de GitHub.
4. En GitHub (**Settings → Secrets and variables → Actions**): secreto `SONAR_TOKEN` = el token y variable `SONAR_HOST_URL` = `https://sonar.tudominio.com`. No hace falta `SONAR_ORGANIZATION`.
5. Haz push a `develop`: el flujo `sonar.yml` sube el análisis a tu servidor.

> Si tu Sonar no es accesible desde Internet, instala un **ejecutor propio** de GitHub Actions en tu servidor (*Settings → Actions → Runners → New self-hosted runner*) y cambia `runs-on: ubuntu-latest` por `runs-on: self-hosted` en `sonar.yml`. Así el análisis corre dentro de tu red.

### Qué analiza y qué no

- Analiza **Java** (backend) y **TypeScript/React** (frontend); el agente en **Rust** está en la lista de fuentes, pero Sonar solo lo revisa si tu edición incluye analizador de Rust. Se excluyen `node_modules`, `dist`, `target`, CSS y documentación.
- La **cobertura de pruebas** no aparece todavía: hoy el repositorio apenas tiene pruebas unitarias. Para medirla, añade el plugin **JaCoCo** a `backend/pom.xml` y pasa `-Dsonar.coverage.jacoco.xmlReportPaths=backend/target/site/jacoco/jacoco.xml`.
- El flujo espera al **Quality Gate** (`sonar.qualitygate.wait=true`): si el código nuevo no lo cumple, el flujo falla y lo verás en el *pull request*. Para que sea informativo y no bloquee, quita esa línea de `sonar.yml`.

## Coverity Scan

[Coverity Scan](https://scan.coverity.com) es un análisis estático gratuito para proyectos de código abierto (público). Detecta fallos de seguridad y de memoria; es de **una cuenta y un proyecto aparte**, y su insignia es la de «coverity passed».

1. Entra en <https://scan.coverity.com> con GitHub y **Add project** → `Tecsharp/Nora`. Te da un **token** y el número de proyecto (el que sale en la URL, `scan.coverity.com/projects/12345`).
2. En GitHub, secreto `COVERITY_SCAN_TOKEN` con ese token y, en el flujo de Coverity, tu correo.
3. Coverity analiza una **compilación** que se le sube (no el código suelto). Con Actions se hace con una acción como [`vapier/coverity-scan-action`](https://github.com/vapier/coverity-scan-action) envolviendo `mvn -DskipTests package` en el directorio `backend`; conviene lanzarlo **semanalmente o a mano** (Coverity limita las subidas por día).
4. Cuando el proyecto exista, activa la insignia del README: quita los comentarios `<!--` `-->` de la línea de Coverity y sustituye `PROJECT_ID` por tu número de proyecto.

## Las insignias del README

| Insignia | De dónde sale | Estado |
|---|---|---|
| **CI** | `https://github.com/Tecsharp/Nora/actions/workflows/ci.yml/badge.svg` | Funciona en cuanto hay una ejecución del flujo `ci.yml`. |
| **Quality Gate / Seguridad / Mantenibilidad** | SonarCloud: `https://sonarcloud.io/api/project_badges/measure?project=TU_CLAVE&metric=alert_status` (otras métricas: `security_rating`, `sqale_rating`, `reliability_rating`, `bugs`). SonarQube propio: **Project Information → Get project badges** (la URL lleva un token). | **Están comentadas en el README** (si no, mostrarían «Project not found»). Cuando exista el primer análisis, descomenta esas líneas del README y pon tu clave o tus URL. |
| **Coverity** | `https://scan.coverity.com/projects/PROJECT_ID/badge.svg` | Comentada en el README hasta que registres el proyecto. |
| Tecnologías y licencia | `shields.io` | Siempre. |

Si el repositorio es **privado**, las insignias de `shields.io` y de SonarCloud no se ven fuera de GitHub; la de CI de GitHub sí se ve a quien tenga acceso.
