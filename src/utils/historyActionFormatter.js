const fmtDateShort = (dateStr) => {
  const [, m, d] = dateStr.split("T")[0].split("-");
  return `${parseInt(m, 10)}-${parseInt(d, 10)}`;
};

const splitCaseValue = (caseValue = "") => {
  const parts = caseValue
    .replace(/[()]/g, "")
    .replace(/\s*-\s*/, " ")
    .trim()
    .split(/\s+/);

  const number = parts.shift() || "";
  const suffix = parts.join(" ");

  return { number, suffix };
};

const normalizeCaseNumberChange = (action) => {
  const match = action.match(/^Case # changed from (.+) to (.+)$/i);
  if (!match) return null;

  const previous = splitCaseValue(match[1].trim());
  const next = splitCaseValue(match[2].trim());

  const numberChanged = previous.number !== next.number;
  const suffixChanged = previous.suffix !== next.suffix;

  if (numberChanged && suffixChanged) {
    return `Case number changed from ${previous.number} to ${next.number} and note changed to "${
      next.suffix || "(removed)"
    }"`;
  }

  if (numberChanged) {
    return `Case number changed from ${previous.number} to ${next.number}`;
  }

  if (suffixChanged) {
    if (!previous.suffix && next.suffix) {
      return `Note added: "${next.suffix}"`;
    }

    if (previous.suffix && !next.suffix) {
      return `Note removed (was "${previous.suffix}")`;
    }

    return `Note changed from "${previous.suffix}" to "${next.suffix}"`;
  }

  return action;
};

export const formatHistoryAction = (action = "") => {
  const dueMatch = action.match(
    /Due changed from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/i
  );

  if (dueMatch) {
    return `Due date changed from ${fmtDateShort(dueMatch[1])} to ${fmtDateShort(
      dueMatch[2]
    )}`;
  }

  const caseNumberChange = normalizeCaseNumberChange(action);
  if (caseNumberChange) return caseNumberChange;

  return action;
};
