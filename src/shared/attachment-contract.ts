import type { AttachmentRecord, TrashedAttachment } from "@domain/attachment";

export type ProjectAttachment = AttachmentRecord;
export type ProjectTrashedAttachment = TrashedAttachment;

export interface AttachmentMutationInput {
  readonly projectId: string;
  readonly attachmentId: string;
}

export interface RestoreAttachmentInput {
  readonly projectId: string;
  readonly trashId: string;
}

export interface GetAttachmentPageImageInput {
  readonly projectId: string;
  readonly attachmentId: string;
  readonly pageNumber: number;
}

export interface AttachmentPageImage {
  readonly jpegBytes: Uint8Array;
  readonly mimeType: "image/jpeg";
}
