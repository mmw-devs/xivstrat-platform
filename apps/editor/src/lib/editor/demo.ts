import { normalizeStructure, type StrategyStructure } from '@xivstrat/content-schema'
export function createDemo(): StrategyStructure {
  const demo = normalizeStructure({
    metadata: {
      id: 'demo',
      name: '示例副本',
      short_name: '极示例',
      type: 'extreme',
      title: '示例副本攻略',
      description: '最终幻想14 示例副本攻略',
      banner: 'banners/07/demo.webp',
      publish_time: '26/01/01 12:00',
      status: 'done',
      video: 'https://www.bilibili.com/video/BVxxxxxx/',
      team: 'MMW攻略组',
    },
    references: [{ label: '示例视频', url: 'https://www.bilibili.com/video/BVxxxxxx/' }],
    macros: [{ name: '示例站位', code: '/p 【机制】MT去A点\n/p {D}去B点' }],
    phases: [
      {
        id: 'p1',
        name: '前半',
        mechanics: [
          {
            id: 'demo-mech',
            name: '示例机制',
            sections: [
              {
                type: 'mechanic',
                title: '机制说明',
                content: [
                  { type: 'text', value: ['处理机制时注意观察标记。'] },
                  { type: 'image', file: 'P1/demo-1.webp', caption: '示意图' },
                ],
              },
              { type: 'solution', title: '固定站位', content: [{ type: 'text', value: ['被点名的人远离人群。'] }] },
              { type: 'note', title: '', content: [{ type: 'text', value: ['这是注意事项。'] }] },
            ],
            sub_mechanics: [],
          },
        ],
      },
    ],
  })
  return demo
}

