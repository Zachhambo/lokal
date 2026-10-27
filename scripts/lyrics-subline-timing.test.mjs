import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectSublineUnits } from '../src/lyrics/sublineTiming.mjs'

const original = {
  text: 'お は よ',
  words: [
    { word: 'お', time: 10, end: 10.5, space: true },
    { word: 'は', time: 11, end: 11.3, space: true },
    { word: 'よ', time: 12, end: 13, space: false },
  ],
}

test('translated words follow the original nonuniform syllable profile', () => {
  const result = projectSublineUnits(original, { text: 'Good morning friend' })
  assert.deepEqual(result.words.map(x => x.word), ['Good', 'morning', 'friend'])
  assert.equal(result.words[0].time, 10)
  assert.equal(result.words.at(-1).end, 13)
  assert.ok(result.words[0].end < result.words[1].end)
  assert.ok(result.words[1].time < result.words[2].time)
  assert.notEqual(result.words[1].end - result.words[1].time,
    result.words[2].end - result.words[2].time)
})

test('romanization without spaces still animates characters', () => {
  const result = projectSublineUnits(original, { text: 'ohayo' })
  assert.deepEqual(result.words.map(w => w.word), ['o', 'h', 'a', 'y', 'o'])
  assert.equal(result.words[0].time, 10)
  assert.equal(result.words.at(-1).end, 13)
})

test('existing provider-supplied romanization timing remains authoritative', () => {
  const romaji = { text: 'o ha yo', words: [{ word: 'o', time: 10.12, end: 10.35 }] }
  assert.equal(projectSublineUnits(original, romaji), romaji)
})

test('untimed and absent sublines remain unchanged', () => {
  const translated = { text: 'Hello' }
  assert.equal(projectSublineUnits({ text: 'こんにちは' }, translated), translated)
  assert.equal(projectSublineUnits(original, null), null)
})

test('projection does not mutate either original song lyrics or translation', () => {
  const translated = { text: 'Hello world' }
  const copy = JSON.stringify(original)
  const projected = projectSublineUnits(original, translated)
  assert.deepEqual(translated, { text: 'Hello world' })
  assert.equal(JSON.stringify(original), copy)
  assert.equal(projected.words.length, 2)
})
