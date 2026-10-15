import { createEmptyStructure, plainTextDocument, type StrategyStructure } from '@xivstrat/content-schema'
export function createDemo(): StrategyStructure {
  const demo = createEmptyStructure()
  demo.metadata = { name: 'm1s', type: 'savage', title: '示例副本攻略', banner: 'banners/07/demo.webp', publish_time: '', status: 'draft', video: 'https://www.bilibili.com/video/BVxxxxxx/' }
  demo.references = [{ label: '示例视频', url: 'https://www.bilibili.com/video/BVxxxxxx/' }]
  demo.macros = [{ name: '示例站位', code: '/p 【机制】MT去A点\n/p {D}去B点' }]
  const text = (value: string) => ({ type: 'text' as const, id: crypto.randomUUID(), doc: plainTextDocument([value]) })
  demo.phases = [{ name: 'p1-前半', mechanics: [{ name: '示例机制', sections: [
    { type: 'mechanic', title: '机制说明', content: [text('处理机制时注意观察标记。'), { type: 'image', file: 'P1/demo-1.webp', caption: '示意图' }] },
    { type: 'solution', title: '固定站位', content: [text('被点名的人远离人群。')] },
    { type: 'note', title: '', content: [text('这是注意事项。')] },
  ], sub_mechanics: [] }] }]
  return demo
}
