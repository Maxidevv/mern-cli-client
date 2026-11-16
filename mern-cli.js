#!/usr/bin/env node
import * as p from '@clack/prompts';
import pc from 'picocolors';
import Table from 'cli-table3';
import { highlight } from 'cli-highlight';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CONFIG_FILE = path.resolve('.mern-cli.json');
const HISTORY_FILE = path.resolve('.mern-cli-history.json');
const MAX_HISTORY = 10;

// ---------- Persistencia ----------
const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const writeJson = (file, data) =>
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });

let config = readJson(CONFIG_FILE, {});
let history = readJson(HISTORY_FILE, []);
const saveConfig = () => writeJson(CONFIG_FILE, config);

function addHistory(entry) {
  history = [entry, ...history.filter(h => !(h.method === entry.method && h.route === entry.route && h.body === entry.body))]
    .slice(0, MAX_HISTORY);
  writeJson(HISTORY_FILE, history);
}

// ---------- Utilidades ----------
const cancelled = (v) => {
  if (p.isCancel(v)) { p.cancel('Operación cancelada'); return true; }
  return false;
};

function decodeJwt(token) {
  try {
    const [h, pl] = token.split('.');
    const dec = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    return { header: dec(h), payload: dec(pl) };
  } catch { return null; }
}

function formatRemaining(sec) {
  if (sec <= 0) return pc.red('expirado');
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600),
        m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(' ');
}

function colorStatus(status) {
  const txt = `${status}`;
  if (status >= 200 && status < 300) return pc.green(pc.bold(txt));
  if (status >= 400 && status < 500) return pc.yellow(pc.bold(txt));
  if (status >= 500) return pc.red(pc.bold(txt));
  return pc.cyan(pc.bold(txt));
}

// ---------- Configuración inicial ----------
async function ensureBaseUrl() {
  if (config.baseUrl) return true;
  const url = await p.text({
    message: 'URL base de la API',
    placeholder: 'http://localhost:4000/api',
    defaultValue: 'http://localhost:4000/api',
    validate: (v) => { try { new URL(v || 'http://localhost:4000/api'); } catch { return 'URL inválida'; } },
  });
  if (cancelled(url)) return false;
  config.baseUrl = url.replace(/\/+$/, '');
  saveConfig();
  return true;
}

// ---------- Cliente HTTP ----------
async function request(method, route, body) {
  const headers = { Accept: 'application/json' };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const opts = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = body; }

  const url = config.baseUrl + (route.startsWith('/') ? route : `/${route}`);
  const spin = p.spinner();
  spin.start(`${method} ${route}`);
  const t0 = performance.now();
  try {
    const res = await fetch(url, opts);
    const ms = Math.round(performance.now() - t0);
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    spin.stop(`${method} ${route} ${pc.dim(`(${ms} ms)`)}`);
    return { status: res.status, statusText: res.statusText, ms, data };
  } catch (err) {
    spin.stop(pc.red(`Error de red: ${err.cause?.code || err.message}`), 1);
    return null;
  }
}

function renderResponse(r) {
  console.log(`\n${pc.bold('Estado:')} ${colorStatus(r.status)} ${r.statusText}   ${pc.bold('Tiempo:')} ${r.ms} ms\n`);
  const { data } = r;
  if (data === null || data === '') return console.log(pc.dim('(sin contenido)\n'));
  if (typeof data === 'string') return console.log(data + '\n');

  const isObjArray = Array.isArray(data) && data.length > 0 &&
    data.every(x => x && typeof x === 'object' && !Array.isArray(x));
  if (isObjArray) {
    const cols = [...new Set(data.flatMap(Object.keys))].slice(0, 8);
    const table = new Table({ head: cols.map(c => pc.cyan(c)), wordWrap: true, colWidths: null });
    for (const row of data) {
      table.push(cols.map(c => {
        const v = row[c];
        const s = v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
        return s.length > 40 ? s.slice(0, 37) + '…' : s;
      }));
    }
    console.log(table.toString());
    console.log(pc.dim(`${data.length} registros\n`));
  } else {
    console.log(highlight(JSON.stringify(data, null, 2), { language: 'json', ignoreIllegals: true }) + '\n');
  }
}

async function execute(method, route, body) {
  const r = await request(method, route, body);
  if (!r) return;
  addHistory({ method, route, body: body ?? null, status: r.status, date: new Date().toISOString() });
  renderResponse(r);
}

// ---------- Acciones del menú ----------
async function login() {
  const mode = await p.select({
    message: '¿Qué querés hacer?',
    options: [
      { value: 'login', label: 'Iniciar sesión' },
      { value: 'register', label: 'Registrar usuario' },
    ],
  });
  if (cancelled(mode)) return;

  const answers = await p.group({
    ...(mode === 'register' && { name: () => p.text({ message: 'Nombre', validate: v => !v && 'Requerido' }) }),
    email: () => p.text({ message: 'Email', validate: v => (!/^\S+@\S+\.\S+$/.test(v || '') ? 'Email inválido' : undefined) }),
    password: () => p.password({ message: 'Password', validate: v => (!v ? 'Requerido' : undefined) }),
  }, { onCancel: () => { p.cancel('Cancelado'); } });
  if (!answers.email || !answers.password) return;

  const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
  const r = await request('POST', endpoint, JSON.stringify(answers));
  if (!r) return;
  addHistory({ method: 'POST', route: endpoint, body: null, status: r.status, date: new Date().toISOString() });

  const token = r.data?.token ?? r.data?.accessToken ?? r.data?.jwt;
  if (r.status >= 200 && r.status < 300 && token) {
    config.token = token;
    saveConfig();
    p.log.success(`${mode === 'login' ? 'Sesión iniciada' : 'Usuario registrado'}. Token guardado.`);
  } else if (r.status >= 200 && r.status < 300 && mode === 'register') {
    p.log.success('Usuario registrado. Ahora iniciá sesión.');
  } else {
    renderResponse(r);
  }
}

async function readBody(method) {
  if (!['POST', 'PUT'].includes(method)) return undefined;
  const how = await p.select({
    message: 'Body JSON',
    options: [
      { value: 'inline', label: 'Escribirlo en una línea' },
      { value: 'editor', label: `Abrir editor ($EDITOR: ${process.env.EDITOR || 'vi'})` },
    ],
  });
  if (cancelled(how)) return null;

  let raw;
  if (how === 'inline') {
    raw = await p.text({
      message: 'JSON',
      placeholder: '{"nombre":"Mesa","precio":1000}',
      validate: v => { try { JSON.parse(v); } catch (e) { return `JSON inválido: ${e.message}`; } },
    });
    if (cancelled(raw)) return null;
  } else {
    const tmp = path.join(os.tmpdir(), `mern-cli-${Date.now()}.json`);
    fs.writeFileSync(tmp, '{\n  \n}\n');
    spawnSyncEditor(tmp);
    raw = fs.readFileSync(tmp, 'utf8');
    fs.unlinkSync(tmp);
    try { JSON.parse(raw); } catch (e) { p.log.error(`JSON inválido: ${e.message}`); return null; }
  }
  return JSON.stringify(JSON.parse(raw));
}

function spawnSyncEditor(file) {
  const [cmd, ...args] = (process.env.EDITOR || 'vi').split(' ');
  spawnSync(cmd, [...args, file], { stdio: 'inherit' });
}

async function customRequest() {
  const method = await p.select({
    message: 'Método HTTP',
    options: ['GET', 'POST', 'PUT', 'DELETE'].map(m => ({ value: m, label: m })),
  });
  if (cancelled(method)) return;
  const route = await p.text({
    message: 'Ruta relativa',
    placeholder: '/productos',
    validate: v => (!v ? 'Requerida' : undefined),
  });
  if (cancelled(route)) return;
  const body = await readBody(method);
  if (body === null) return;
  await execute(method, route, body);
}

async function showHistory() {
  if (!history.length) return p.log.info('Todavía no hay peticiones en el historial.');
  const choice = await p.select({
    message: 'Historial (Enter para re-ejecutar)',
    options: [
      ...history.map((h, i) => ({
        value: i,
        label: `${h.method.padEnd(6)} ${h.route}`,
        hint: `${h.status} · ${new Date(h.date).toLocaleString()}`,
      })),
      { value: -1, label: pc.dim('← Volver') },
    ],
  });
  if (cancelled(choice) || choice === -1) return;
  const h = history[choice];
  await execute(h.method, h.route, h.body ?? undefined);
}

function showToken() {
  if (!config.token) return p.log.warn('No hay token. Iniciá sesión primero.');
  const jwt = decodeJwt(config.token);
  if (!jwt) return p.log.error('El token guardado no es un JWT válido.');
  const { payload, header } = jwt;
  const lines = [
    pc.bold('Header'), highlight(JSON.stringify(header, null, 2), { language: 'json' }),
    pc.bold('Payload'), highlight(JSON.stringify(payload, null, 2), { language: 'json' }),
  ];
  if (payload.exp) {
    const left = payload.exp - Math.floor(Date.now() / 1000);
    lines.push(`${pc.bold('Expira:')} ${new Date(payload.exp * 1000).toLocaleString()}`);
    lines.push(`${pc.bold('Tiempo restante:')} ${formatRemaining(left)}`);
  } else {
    lines.push(pc.dim('El token no tiene claim "exp".'));
  }
  p.note(lines.join('\n'), 'Token JWT');
}

// ---------- Main ----------
async function main() {
  p.intro(pc.bgCyan(pc.black(' MERN CLI ')));
  if (!(await ensureBaseUrl())) return;
  p.log.info(`API: ${pc.cyan(config.baseUrl)}  ${config.token ? pc.green('● autenticado') : pc.dim('○ sin sesión')}`);

  while (true) {
    const action = await p.select({
      message: 'Menú principal',
      options: [
        { value: 'login', label: 'Iniciar sesión / Registrar usuario' },
        { value: 'request', label: 'Ejecutar petición personalizada' },
        { value: 'history', label: 'Ver historial de peticiones recientes' },
        { value: 'token', label: 'Ver estado del Token JWT actual' },
        { value: 'url', label: 'Cambiar URL base' },
        { value: 'exit', label: 'Salir' },
      ],
    });
    if (p.isCancel(action) || action === 'exit') break;
    if (action === 'login') await login();
    if (action === 'request') await customRequest();
    if (action === 'history') await showHistory();
    if (action === 'token') showToken();
    if (action === 'url') { delete config.baseUrl; await ensureBaseUrl(); }
  }
  p.outro('¡Hasta luego!');
}

main().catch(e => { console.error(e); process.exit(1); });
