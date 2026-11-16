# mern-cli-client

Aplicación interactiva de consola (TUI) para autenticarte contra tu propio backend Node.js/Express, manejar el token JWT y ejecutar peticiones HTTP sobre tus endpoints protegidos, sin salir de la terminal.

## Requisitos

- Node.js 18 o superior (usa `fetch` nativo)
- Un backend con un endpoint `POST /auth/login` que devuelva un JWT

## Instalación

```bash
npm install
```

## Uso

```bash
npm start
# o
node mern-cli.js
```

La primera vez te pide la URL base de la API (por ejemplo `http://localhost:4000/api`) y la guarda en `.mern-cli.json`.

## Funcionalidades

### Menú principal

Se navega con las flechas del teclado y Enter:

- **Iniciar sesión / Registrar usuario**
- **Ejecutar petición personalizada** (GET, POST, PUT, DELETE)
- **Ver historial de peticiones recientes**
- **Ver estado del Token JWT actual**
- **Cambiar URL base**
- **Salir**

### Autenticación

- Pide email y password (la contraseña se oculta al escribirla).
- Envía `POST /auth/login` (o `POST /auth/register` al registrar).
- Si la respuesta es exitosa, guarda el token y lo adjunta como `Authorization: Bearer <token>` en todas las peticiones siguientes.
- El token se busca en la respuesta bajo las claves `token`, `accessToken` o `jwt`.

### Constructor de peticiones

- Elegís el método de una lista y escribís la ruta relativa (`/productos`, `/usuarios/64ab3...`).
- En POST y PUT podés ingresar el body JSON en una línea o abrir tu editor (`$EDITOR`).
- El JSON se valida con `JSON.parse()` antes de enviarse.

### Visualización de la respuesta

- Spinner mientras la petición está en curso y tiempo de respuesta en milisegundos.
- Código de estado con colores: verde (2xx), amarillo (4xx), rojo (5xx).
- JSON con indentación y resaltado de sintaxis.
- Si la respuesta es un arreglo de objetos, se muestra como tabla.

### Historial

Guarda las últimas 10 peticiones (método, ruta, body, estado y fecha) en `.mern-cli-history.json`. Desde el menú podés re-ejecutar cualquiera con Enter.

### Estado del token

Muestra el header y el payload decodificados, la fecha de expiración y el tiempo restante. Solo decodifica el token, no verifica la firma.

## Archivos que genera

| Archivo | Contenido |
| --- | --- |
| `.mern-cli.json` | URL base y token JWT |
| `.mern-cli-history.json` | Últimas 10 peticiones |

Ambos se crean en el directorio desde el que ejecutás la aplicación. **Agregalos a tu `.gitignore`**, ya que contienen el token y los bodies de tus peticiones:

```
.mern-cli.json
.mern-cli-history.json
```

## Dependencias

| Librería | Uso |
| --- | --- |
| `@clack/prompts` | Menús, inputs, password y spinner |
| `picocolors` | Colores en la terminal |
| `cli-table3` | Tablas para arreglos de objetos |
| `cli-highlight` | Resaltado de sintaxis JSON |

## Limitaciones conocidas

- La tabla solo se genera si la respuesta es directamente un arreglo (no si viene envuelto en `{ data: [...] }`).
- No hay opción de cerrar sesión ni manejo automático de tokens vencidos o respuestas 401.
- No hay timeout en las peticiones.
- No se pueden agregar cabeceras personalizadas.
- Si no tenés `$EDITOR` definido, se usa `vi`; en Windows conviene definirlo (por ejemplo `set EDITOR=notepad`).

## Personalización

- **Nombre de la clave del token:** se ajusta en la función `login()` de `mern-cli.js`.
- **Campos del registro:** también en `login()` (por defecto envía `name`, `email` y `password`).
- **Cantidad de peticiones en el historial:** constante `MAX_HISTORY`.