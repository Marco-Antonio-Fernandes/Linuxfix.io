import { describe, it, expect } from 'vitest';
import { defaults, normalize } from './config';
describe('configuração importada',()=>{
 it('limita valores externos e rejeita cores e imagens remotas',()=>{const c=normalize({opacity:900,iconSize:-9,accent:'red;url(x)',wallpaperImage:'https://example.com/a.png'});expect(c.opacity).toBe(100);expect(c.iconSize).toBe(28);expect(c.accent).toBe(defaults.accent);expect(c.wallpaperImage).toBe('');});
 it('rejeita arquivo inválido ou versão incompatível',()=>{expect(()=>normalize(null)).toThrow();expect(()=>normalize([])).toThrow();expect(()=>normalize({version:2})).toThrow();});
 it('preserva argumentos separados sem interpretá-los como comandos',()=>{const c=normalize({...defaults,shortcuts:[{...defaults.shortcuts[0],args:['pasta com espaços','$(echo nope)',42]}]});expect(c.shortcuts[0].args).toEqual(['pasta com espaços','$(echo nope)']);});
 it('preserva lista vazia e preferências booleanas desligadas',()=>{const c=normalize({shortcuts:[],clock:false,seconds:'true'});expect(c.shortcuts).toEqual([]);expect(c.clock).toBe(false);expect(c.seconds).toBe(false);});
 it('preserva configuração em exportações e importações repetidas',()=>{const first=normalize(defaults);expect(normalize(first)).toEqual(first);});
 it('mantém docks independentes com atalhos e posições próprias',()=>{const c=normalize({docks:[{id:'main',name:'Baixo',position:'bottom',shortcuts:[]},{id:'side',name:'Lateral',position:'right',iconSize:56,shortcuts:[]}],activeDockId:'side'});expect(c.docks).toHaveLength(2);expect(c.activeDockId).toBe('side');expect(c.docks[1].position).toBe('right');expect(c.docks[1].iconSize).toBe(56);expect(c.docks[0].shortcuts).toEqual([]);});
});
