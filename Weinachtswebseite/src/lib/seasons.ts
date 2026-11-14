import type { WishListSlug } from './types'

export const seasons = {
  winter: { label: 'Winter', title: 'Weihnachtswunschliste', ink: '#183752', accent: '#34668b', paper: '#edf5fc', symbol: '❄' },
  spring: { label: 'Frühling', title: 'Frühlingswunschliste', ink: '#293e2f', accent: '#42664c', paper: '#eef6e9', symbol: '✿' },
  summer: { label: 'Sommer', title: 'Sommerwunschliste', ink: '#5b361b', accent: '#925716', paper: '#fff5df', symbol: '☀' },
  autumn: { label: 'Herbst', title: 'Herbstwunschliste', ink: '#522b23', accent: '#8c4731', paper: '#faeee6', symbol: '✦' },
} as const

export type Season = keyof typeof seasons
export const listNames = { janus: 'Janus', marlene: 'Marlene' } as const
export const bulkDeleteEmail = 'janus.kleine@cbg-duelmen.de'

export function wishlistTitle(season: Season, list: WishListSlug) {
  return `${seasons[season].title} von ${listNames[list]}`
}
