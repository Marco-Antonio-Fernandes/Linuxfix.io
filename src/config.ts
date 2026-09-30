export type Shortcut = { id: string; name: string; path: string; args: string[]; icon: string; color: string; kind: 'linux' | 'wine' | 'desktop'; prefix: string; cwd: string };
export type DockConfig = { id: string; name: string; enabled: boolean; panelColor: string; opacity: number; blur: number; radius: number; iconSize: number; gap: number; position: 'bottom' | 'top' | 'left' | 'right'; margin: number; wallpaper: string; wallpaperImage: string; iconStyle: 'color' | 'mono'; clock: boolean; seconds: boolean; memory: boolean; battery: boolean; shortcuts: Shortcut[] };
export type Config = { version: 1; theme: 'dark' | 'light' | 'system'; accent: string; docks: DockConfig[]; activeDockId: string; panelColor: string; opacity: number; blur: number; radius: number; iconSize: number; gap: number; position: 'bottom' | 'top' | 'left' | 'right'; margin: number; wallpaper: string; wallpaperImage: string; iconStyle: 'color' | 'mono'; clock: boolean; seconds: boolean; memory: boolean; battery: boolean; shortcuts: Shortcut[] };
export const wallpapers = [
  { id: 'dusk', name: 'Entardecer', colors: ['#222143', '#8273a4', '#eab3a8'] },
  { id: 'aurora', name: 'Aurora', colors: ['#092d36', '#477f79', '#b4c9a1'] },
  { id: 'sand', name: 'Dunas', colors: ['#604439', '#bc947a', '#e7d5b4'] },
  { id: 'midnight', name: 'Meia-noite', colors: ['#111a36', '#354985', '#799cc7'] },
];
const shortcut = (id: string, name: string, path: string, icon: string, color: string): Shortcut => ({ id, name, path, icon, color, args: [], kind: 'linux', prefix: '', cwd: '' });
const defaultShortcuts = [shortcut('files','Arquivos','dolphin','folder','#72a9ee'),shortcut('browser','Firefox','firefox','globe','#f2a36b'),shortcut('terminal','Terminal','konsole','terminal','#9399b1'),shortcut('code','VS Code','code','code','#73b6ef'),shortcut('music','Música','spotify','music','#7fc99e')];
const defaultDock = (id = 'main', name = 'Principal'): DockConfig => ({ id, name, enabled: true, panelColor: '#202027', opacity: 78, blur: 24, radius: 22, iconSize: 42, gap: 10, position: 'bottom', margin: 18, wallpaper: 'dusk', wallpaperImage: '', iconStyle: 'color', clock: true, seconds: false, memory: false, battery: false, shortcuts: structuredClone(defaultShortcuts) });
export const defaults: Config = { version: 1, theme: 'dark', accent: '#b7a2f8', activeDockId: 'main', ...defaultDock(), docks: [defaultDock()] };
const hex = (v: unknown, fallback: string) => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v) ? v : fallback;
const number = (v: unknown, lo: number, hi: number, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const str = (v: unknown, fallback = '', max = 4096) => typeof v === 'string' ? v.slice(0, max) : fallback;
const bool = (v: unknown, fallback: boolean) => typeof v === 'boolean' ? v : fallback;
const normalizeShortcuts = (value: unknown, fallback: Shortcut[]) => Array.isArray(value) ? value.slice(0,30).filter(s=>s && typeof s==='object').map((s,i)=>{
  const item=s as Record<string,unknown>;
  const icon=typeof item.icon==='string' && /^data:image\/(png|jpeg|webp);base64,/.test(item.icon) && item.icon.length<350000 ? item.icon : str(item.icon,'box',30);
  return { id:str(item.id,`shortcut-${i}`,100), name:str(item.name,'Aplicativo',80), path:str(item.path), args:Array.isArray(item.args)?(item.args as unknown[]).filter((a):a is string=>typeof a==='string').slice(0,64):[], icon, color:hex(item.color,'#b7a2f8'), kind:['linux','wine','desktop'].includes(item.kind as string)?item.kind as Shortcut['kind']:'linux', prefix:str(item.prefix), cwd:str(item.cwd) };
}) : structuredClone(fallback);
const normalizeDock = (value: unknown, id: string, name: string, fallback?: DockConfig): DockConfig => {
  const c = (value && typeof value === 'object' && !Array.isArray(value)) ? value as Record<string,unknown> : {};
  const base = fallback ?? defaultDock(id,name);
  return { id, name:str(c.name,name,60), enabled:bool(c.enabled,true), panelColor:hex(c.panelColor,base.panelColor), opacity:number(c.opacity,20,100,base.opacity), blur:number(c.blur,0,48,base.blur), radius:number(c.radius,0,40,base.radius), iconSize:number(c.iconSize,28,64,base.iconSize), gap:number(c.gap,4,24,base.gap), margin:number(c.margin,0,64,base.margin), position:['bottom','top','left','right'].includes(String(c.position)) ? c.position as DockConfig['position'] : base.position, wallpaper:wallpapers.some(w=>w.id===c.wallpaper) ? String(c.wallpaper) : base.wallpaper, wallpaperImage:typeof c.wallpaperImage==='string' && /^data:image\/(png|jpeg|webp);base64,/.test(c.wallpaperImage) && c.wallpaperImage.length<3000000 ? c.wallpaperImage : '', iconStyle:c.iconStyle==='mono'?'mono':'color', clock:bool(c.clock,base.clock), seconds:bool(c.seconds,base.seconds), memory:bool(c.memory,base.memory), battery:bool(c.battery,base.battery), shortcuts:normalizeShortcuts(c.shortcuts,base.shortcuts) };
};
export function normalize(input: unknown): Config {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuração inválida. Escolha um arquivo JSON do Fixio Shell.');
  const c = input as Record<string, unknown>;
  if (c.version !== undefined && c.version !== 1) throw new Error('Versão de configuração não suportada.');
  const legacy = normalizeDock(c,'main','Principal',defaultDock());
  const docks = (Array.isArray(c.docks) ? c.docks : [legacy]).slice(0,8).map((dock,i)=>{
    const raw = dock && typeof dock === 'object' ? dock as Record<string,unknown> : {};
    return normalizeDock(raw,str(raw.id,`dock-${i}`,64),str(raw.name,i===0?'Principal':`Dock ${i+1}`,60),i===0?legacy:defaultDock(`dock-${i}`,`Dock ${i+1}`));
  });
  if (!Array.isArray(c.docks) || c.activeDockId === undefined || c.activeDockId === 'main') docks[0]=legacy;
  const normalizedDocks=docks.length?docks:[legacy];
  const activeId=str(c.activeDockId,normalizedDocks[0].id,64);
  const active=normalizedDocks.find(dock=>dock.id===activeId) ?? normalizedDocks[0];
  return { version:1, theme:['dark','light','system'].includes(String(c.theme)) ? c.theme as Config['theme'] : defaults.theme, accent:hex(c.accent,defaults.accent), docks:normalizedDocks, activeDockId:active.id, ...active };
}
export const native = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const storageKey = 'fixio-shell.config.v1';
