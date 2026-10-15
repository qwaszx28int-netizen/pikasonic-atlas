import type { Track } from './catalog'

const GENRES: Record<string, string> = {
  electronic: '电子音乐',
  electronica: '电子音乐',
  dance: '电子舞曲',
  'j-pop': 'J-Pop · 日系流行',
  pop: '流行音乐',
  anime: '动漫音乐',
  soundtrack: '原声音乐',
  サウンドトラック: '原声音乐',
  'future bass': 'Future Bass',
  house: 'House',
  dubstep: 'Dubstep',
  'drum & bass': 'Drum & Bass',
  trance: 'Trance',
  edm: 'EDM · 电子舞曲',
  trap: 'Trap',
  futurebass: 'Future Bass',
  'bass house': 'Bass House',
  'melodic drumstep': 'Melodic Drumstep',
  'progressive house': 'Progressive House',
  'electro house': 'Electro House',
  'melodic dubstep': 'Melodic Dubstep',
  jpop: 'J-Pop · 日系流行',
  ダンス: '电子舞曲',
  'dance & edm': '电子舞曲',
  'future bounce': 'Future Bounce',
  'future house': 'Future House',
  'melodic house': 'Melodic House',
  'glitch hop': 'Glitch Hop',
  hardstyle: 'Hardstyle',
  happycore: 'Happycore',
  drumstep: 'Drumstep',
  'kawaii bass': 'Kawaii Bass',
  'kawaii midtempo': 'Kawaii Midtempo',
  '8bit house': '8-bit House',
  complextro: 'Complextro',
  chilltrap: 'Chilltrap',
  'video game': '游戏音乐',
  melodic: 'Melodic · 旋律向',
  epic: 'Epic · 史诗向',
}

export function genreInfo(track: Track): { genre: string; sourceName: string; sourceUrl: string } {
  // The artist's own explicit track tag can be more specific than a store category.
  const detailed = track.genreDetails?.find(
    (info) => info.sourceName === 'SoundCloud' && info.genre.trim(),
  )
  return (
    detailed || {
      genre: track.genre || '',
      sourceName: track.sourceName || '发行平台',
      sourceUrl: track.sourceUrl,
    }
  )
}

export function genreLabel(track: Track): string {
  const info = genreInfo(track)
  return GENRES[info.genre.trim().toLowerCase()] || info.genre || '曲风待核实'
}

export function genreDescription(track: Track): string {
  const info = genreInfo(track)
  const raw = info.genre.trim().toLowerCase()
  if (!raw) return '来源未提供可靠的逐曲流派，保留待核实；欢迎贡献有来源的分类。'
  if (raw === 'electronic' || raw === 'electronica')
    return '平台归类为电子音乐，表示这次发行采用电子音乐这一较宽的分类。Future Bass、House 等更细的曲风需要逐曲核验，不由艺人整体风格直接推定。'
  if (raw === 'dance' || raw === 'edm')
    return '平台将它归入舞曲。可以优先留意节拍、律动与段落能量的变化；这一平台分类本身不说明准确 BPM 或具体制作流派。'
  if (raw === 'j-pop' || raw === 'pop')
    return '平台将它归入流行音乐分类。可以关注人声、旋律主题与段落之间的关系；流行分类与电子编曲也可能同时存在。'
  if (raw.includes('soundtrack') || raw === 'サウンドトラック')
    return '平台将该发行归入原声音乐。这更多反映作品的发行语境，不能据此确定其节奏或电子音乐子流派。'
  if (raw.replace(/\s/g, '') === 'futurebass')
    return '来源将这首作品标为 Future Bass（未来贝斯）。这一风格常与富有起伏的电子和弦和鲜明的旋律联系在一起；可以带着这些线索聆听，再判断这首作品如何呈现自己的变化。'
  if (raw === 'bass house')
    return '来源将这首作品标为 Bass House，通常结合 House 的律动与突出的低频音色。聆听时可以关注节拍与低音之间的呼应；具体配器与速度需要结合原曲核验。'
  if (raw === 'melodic drumstep')
    return '来源将这首作品标为 Melodic Drumstep，兼顾旋律表达与 Drumstep 的节奏语汇。可以留意旋律线与鼓组之间如何建立对比，这是一条导听线索而非逐段制作分析。'
  return `${info.sourceName} 为这首作品提供的曲风标签是 ${info.genre}。这里保留原始分类，便于继续核对；平台标签与听众的风格理解可能不同。`
}
