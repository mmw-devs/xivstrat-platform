export type GeneratedFiles = Record<string, string>

export interface ImageLibraryEntry {
  name: string
  path: string
  thumb: string
}

export interface CosSettings {
  'cos-secret-id': string
  'cos-secret-key': string
  'cos-bucket': string
  'cos-region': string
}
