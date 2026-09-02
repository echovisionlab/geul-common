export type MaterializedInlineNode = {
  text?: string;
  content?: readonly MaterializedInlineNode[];
};

export type MaterializedBlockLike<
  TBlock extends MaterializedBlockLike<TBlock>,
> = {
  type?: string;
  content?: readonly MaterializedInlineNode[] | string | object | null;
  children?: readonly TBlock[];
};

function inlineContentHasText(
  content: readonly MaterializedInlineNode[],
): boolean {
  return content.some((node) => {
    if (typeof node.text === "string" && node.text.trim().length > 0) {
      return true;
    }

    return Array.isArray(node.content) && inlineContentHasText(node.content);
  });
}

export function isEmptyParagraphBlock<
  TBlock extends MaterializedBlockLike<TBlock>,
>(block: TBlock): boolean {
  if (block.type !== "paragraph") {
    return false;
  }

  if (Array.isArray(block.children) && block.children.length > 0) {
    return false;
  }

  if (typeof block.content === "string") {
    return block.content.trim().length === 0;
  }

  if (Array.isArray(block.content)) {
    return !inlineContentHasText(block.content);
  }

  return block.content == null;
}

export function stripTrailingEmptyParagraphBlocks<
  TBlock extends MaterializedBlockLike<TBlock>,
>(blocks: readonly TBlock[]): TBlock[] {
  let end = blocks.length;

  while (end > 0 && isEmptyParagraphBlock(blocks[end - 1])) {
    end -= 1;
  }

  return blocks.slice(0, end);
}
