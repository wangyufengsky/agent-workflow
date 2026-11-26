import {
  createDesignOp,
  createDesignTemplateOp,
  deleteDesignOp,
  deleteDesignTemplateOp,
  exportDesignOp,
  generateDesignOp,
  getDesignOp,
  getDesignSourceOp,
  getDesignStalenessOp,
  incrementalUpdateDesignOp,
  listDesignsOp,
  listDesignTemplatesOp,
  restoreDesignSectionOp,
  reviewDesignOp,
  reviseDesignOutlineOp,
  reviseDesignSectionOp,
  stopDesignOp,
  updateDesignOp,
  updateDesignOutlineOp,
  updateDesignTemplateOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { DesignsService } from './designs.service.ts';

export function designsOperations(service: DesignsService) {
  return [
    implement(listDesignsOp, (input) => service.list(input)),
    implement(getDesignSourceOp, ({ id, fileId }) => service.source(id, fileId)),
    implement(getDesignStalenessOp, ({ id }) => service.staleness(id)),
    implement(getDesignOp, ({ id }) => service.get(id)),
    implement(createDesignOp, (input) => service.create(input)),
    implement(updateDesignOp, (input) => service.update(input)),
    implement(listDesignTemplatesOp, (input) => service.listTemplates(input)),
    implement(createDesignTemplateOp, (input) => service.createTemplate(input)),
    implement(updateDesignTemplateOp, (input) => service.updateTemplate(input)),
    implement(deleteDesignTemplateOp, ({ key }) => service.deleteTemplate(key)),
    implement(updateDesignOutlineOp, (input) => service.updateOutline(input)),
    implement(reviseDesignOutlineOp, (input) => service.reviseOutline(input)),
    implement(generateDesignOp, (input) => service.generate(input)),
    implement(reviseDesignSectionOp, (input) => service.reviseSection(input)),
    implement(incrementalUpdateDesignOp, (input) => service.incrementalUpdate(input)),
    implement(restoreDesignSectionOp, ({ id, sectionId }) => service.restoreSection(id, sectionId)),
    implement(reviewDesignOp, (input) => service.review(input)),
    implement(stopDesignOp, ({ id }) => service.stop(id)),
    implement(exportDesignOp, (input) => service.export(input)),
    implement(deleteDesignOp, ({ id }) => service.delete(id)),
  ];
}
