import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {looksLikeProject, detectProjectRoot, resolveWorkRoot, workRoots, readProjectMeta} from '../../server-control/root-detect.mjs';

const makeProject = (name='proj') => {
  const root = mkdtempSync(join(tmpdir(), 'bot-root-'));
  mkdirSync(join(root,'dist'),{recursive:true});
  mkdirSync(join(root,'bootstrap'),{recursive:true});
  writeFileSync(join(root,'dist','index.mjs'),'// bundle');
  writeFileSync(join(root,'bootstrap','index.mjs'),'// boot');
  writeFileSync(join(root,'package.json'),JSON.stringify({name,version:'8.1.0'}));
  return root;
};

test('التعرف على مشروع البوت من علاماته', () => {
  const root = makeProject();
  try {
    assert.equal(looksLikeProject(root), true);
    assert.equal(looksLikeProject(join(root,'dist')), false, 'مجلد dist ليس جذر المشروع');
    assert.equal(looksLikeProject('/definitely/missing/path'), false);
    assert.equal(detectProjectRoot(join(root,'dist')), root, 'يصعد من داخل dist إلى الجذر');
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('المسار القديم غير الصالح يُرفض ويُستبدل بجذر المشروع الحقيقي', () => {
  const root = makeProject();
  try {
    const logs = [];
    const found = resolveWorkRoot('/home/oldhost/alsmanu-legacy', {here: join(root,'server-control'), logger:{warn:m=>logs.push(m)}});
    assert.equal(found.base, root);
    assert.notEqual(found.source, 'settings');
    assert.ok(logs.some(m => /PATH-PORTABILITY/.test(m)), 'يجب تسجيل سبب تغيير المسار');
    const okRoot = resolveWorkRoot(root, {here: join(root,'server-control')});
    assert.equal(okRoot.base, root);
    assert.equal(okRoot.source, 'settings');
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('BOT_BASE_DIR يُحترم قبل أي تخمين', () => {
  const root = makeProject();
  const previous = process.env.BOT_BASE_DIR;
  try {
    process.env.BOT_BASE_DIR = root;
    const found = resolveWorkRoot('/nope/nope', {here:'/tmp'});
    assert.equal(found.source, 'env:BOT_BASE_DIR');
    assert.equal(found.base, root);
  } finally {
    if (previous === undefined) delete process.env.BOT_BASE_DIR; else process.env.BOT_BASE_DIR = previous;
    rmSync(root,{recursive:true,force:true});
  }
});

test('المسارات التي تعرضها اللوحة تُشتق من الجذر المكتشف', () => {
  const root = makeProject('whatsapp-bot-pro');
  try {
    const roots = workRoots(root);
    assert.equal(roots.project, root);
    assert.equal(roots.data, join(root,'data'));
    assert.equal(roots.version, '8.1.0');
    assert.deepEqual(readProjectMeta(root), {name:'whatsapp-bot-pro',version:'8.1.0'});
  } finally { rmSync(root,{recursive:true,force:true}); }
});
