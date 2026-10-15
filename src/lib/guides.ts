import { formatDate, isCollaboration, isRemix } from './catalog.ts'
import type { Track } from './catalog'
import { TITLE_NOTES } from './title-notes.ts'

const titleNotes: Record<string, string> = {
  'new genesis':
    'Genesis 通常指起源或开端，New Genesis 可以理解为“新的起点”。可以把这个标题当作一次重新出发的邀请，再留意音乐如何建立并推进情绪。',
  rebirth:
    'Rebirth 意为“重生”。把“重生”当作一条阅读标题的线索：聆听过程中，哪些声音像是在告别，哪些段落又带来了新的开始？',
  lost: 'Lost 可以表达迷失或失去。标题留下了开放的叙事空间，可以试着观察旋律、节奏与自己的联想是否相互呼应。',
  nostalgia:
    'Nostalgia 意为“怀旧”或“乡愁”。这个词指向记忆与距离，可以留意哪些音色或旋律使你联想到自己的某个时刻。',
  happiness:
    'Happiness 意为“幸福”。可以带着这个直接而温暖的词进入作品，观察自己的感受是否始终与标题一致。',
  sky: 'Sky 意为“天空”。它既可以是具体的景象，也可以是想象的空间。留意不同声部的远近感，以及旋律给你的空间联想。',
  hope: 'Hope 意为“希望”。可以用这个词作为聆听起点，留意作品中让你产生期待的段落，以及这种期待如何得到回应。',
  dream:
    'Dream 意为“梦”。它给作品留下了介于现实与想象之间的解读空间，可以观察重复出现的音乐片段如何影响你的感受。',
  adventure:
    'Adventure 意为“冒险”。可以把聆听当作一段旅程，记录音乐从开场到结尾经过了怎样的情绪变化。',
  starlight:
    'Starlight 意为“星光”。可以把它作为一幅想象的画面，再留意作品中明暗、疏密与空间的变化。',
}

export function getGuide(track: Track) {
  let name = track.title.toLocaleLowerCase().trim()
  while (/[)\]]$/.test(name)) {
    const stripped = name.replace(/\s*[([][^()[\]]*[)\]]\s*$/, '').trim()
    if (stripped === name) break
    name = stripped
  }
  const titleNote =
    TITLE_NOTES[track.title.toLowerCase()] ||
    TITLE_NOTES[name] ||
    titleNotes[name] ||
    `《${track.title}》是这首作品在发行目录中使用的原始标题。标题既是识别作品的线索，也可以成为个人联想的起点；不熟悉的语种或词义，建议结合艺人的原始发布说明进一步了解。`
  const collab = isCollaboration(track)
  const remix = isRemix(track)
  return {
    intro: `《${track.title}》由 ${track.artist} 署名，归档于《${track.album}》。${track.releaseDate ? `公开目录中的日期为 ${formatDate(track.releaseDate)}，可能对应发行或重新上架时间。` : '目前的资料尚未核实具体发行日期。'}${remix ? '标题或发行名称包含改编版本标记，比较时应注意与原版区分。' : collab ? '这是一首合作署名作品，合作对象以发行平台的完整署名为准。' : '你可以通过来源链接查看这首作品的正式信息。'}`,
    titleNote,
    versionNote: remix
      ? '改编版本适合与原曲对照：辨认哪些主题被保留，哪些节奏或编排发生变化。不同版本不一定拥有相同的制作署名。'
      : collab
        ? '合作署名说明多位艺人共同参与了这次发行。仅凭署名无法判断每个人的具体分工；可以留意不同音乐元素的衔接，再查阅正式制作名单。'
        : '先完整聆听一次，再回到你最有感受的片段。可以从主旋律、节奏与声音层次三个角度，记录你自己的理解。',
    questions: [
      '开场的第一个声音，给你怎样的空间或情绪印象？',
      '主旋律第一次出现与再次回归时，有什么变化？',
      '哪个段落最让你想重听？试着说出一个具体的声音。',
    ],
  }
}
