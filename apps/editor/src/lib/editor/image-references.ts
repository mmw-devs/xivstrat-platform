import type { StrategyStructure, StrategyMechanic } from '@xivstrat/content-schema'

export function imageReferences(structure: StrategyStructure): string[] {
  const paths = new Set<string>()
  if (structure.metadata.banner) paths.add(structure.metadata.banner)
  const visit = (mechanic: StrategyMechanic) => {
    mechanic.sections.forEach(section => section.content.forEach(block => {
      if (block.type === 'image' && block.file) paths.add(block.file)
    }))
    mechanic.sub_mechanics.forEach(visit)
  }
  structure.phases.forEach(phase => phase.mechanics.forEach(visit))
  return [...paths]
}

export function hasManagedImages(structure: StrategyStructure): boolean {
  return imageReferences(structure).some(path => path.startsWith('assets/images/'))
}
