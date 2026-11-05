import {expect,it} from 'vitest';
import {CHARACTER_SHAPES,DEFAULT_CHARACTER,characterDefaultName,characterLabel,characterNameOptions} from '../../src/shared/character-catalog';
import {botNameOptions} from '../../src/shared/bot-catalog';

it('labels an unnamed soup companion Bao, never the app name',()=>{
 expect(DEFAULT_CHARACTER).toMatchObject({personalName:null,look:{shape:'soup'}});
 expect(characterLabel(DEFAULT_CHARACTER)).toBe('Bao');
});

it('gives every catalog shape, including the retired one, its own non-Glint default name',()=>{
 for(const shape of CHARACTER_SHAPES){
  const profile={...DEFAULT_CHARACTER,look:{...DEFAULT_CHARACTER.look,shape:shape.id}},label=characterLabel(profile);
  expect(label,shape.id).toBe(characterDefaultName(shape.id));
  expect(label,shape.id).not.toMatch(/glint/i);
  expect(label,shape.id).not.toBe(shape.label);
  expect(botNameOptions(shape.id),shape.id).toEqual(characterNameOptions(shape.id));
  expect(botNameOptions(shape.id).length,shape.id).toBeGreaterThan(0);
  expect(botNameOptions(shape.id).some(name=>/glint/i.test(name)),shape.id).toBe(false);
 }
});

it('always prefers a name the user chose',()=>{
 for(const shape of CHARACTER_SHAPES)expect(characterLabel({personalName:'Juniper',look:{...DEFAULT_CHARACTER.look,shape:shape.id}})).toBe('Juniper');
 expect(characterLabel({...DEFAULT_CHARACTER,personalName:'Glint'})).toBe('Glint');
});
