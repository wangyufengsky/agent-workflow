import { z } from 'zod';

export const ideConfigurationSchema = z.object({
  name: z.string(),
  type: z.enum(['Application', 'SpringBootApplicationConfigurationType']),
  source: z.string(),
  location: z.enum(['worktree', 'project']),
  mainClass: z.string(),
  module: z.string().optional(),
  directory: z.string().optional(),
  javaVersion: z.number().int().optional(),
  includeProvided: z.boolean(),
  profile: z.enum(['test', 'qa']).optional(),
  review: z.array(z.string()),
});
export type IdeConfiguration = z.infer<typeof ideConfigurationSchema>;

export const ideConfigurationsSchema = z.object({
  configurations: z.array(ideConfigurationSchema),
  warnings: z.array(z.string()),
});
