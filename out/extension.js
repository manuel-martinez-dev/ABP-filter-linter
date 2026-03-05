"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/css-what/lib/commonjs/types.js
var require_types = __commonJS({
  "node_modules/css-what/lib/commonjs/types.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.AttributeAction = exports2.IgnoreCaseMode = exports2.SelectorType = void 0;
    var SelectorType;
    (function(SelectorType2) {
      SelectorType2["Attribute"] = "attribute";
      SelectorType2["Pseudo"] = "pseudo";
      SelectorType2["PseudoElement"] = "pseudo-element";
      SelectorType2["Tag"] = "tag";
      SelectorType2["Universal"] = "universal";
      SelectorType2["Adjacent"] = "adjacent";
      SelectorType2["Child"] = "child";
      SelectorType2["Descendant"] = "descendant";
      SelectorType2["Parent"] = "parent";
      SelectorType2["Sibling"] = "sibling";
      SelectorType2["ColumnCombinator"] = "column-combinator";
    })(SelectorType = exports2.SelectorType || (exports2.SelectorType = {}));
    exports2.IgnoreCaseMode = {
      Unknown: null,
      QuirksMode: "quirks",
      IgnoreCase: true,
      CaseSensitive: false
    };
    var AttributeAction;
    (function(AttributeAction2) {
      AttributeAction2["Any"] = "any";
      AttributeAction2["Element"] = "element";
      AttributeAction2["End"] = "end";
      AttributeAction2["Equals"] = "equals";
      AttributeAction2["Exists"] = "exists";
      AttributeAction2["Hyphen"] = "hyphen";
      AttributeAction2["Not"] = "not";
      AttributeAction2["Start"] = "start";
    })(AttributeAction = exports2.AttributeAction || (exports2.AttributeAction = {}));
  }
});

// node_modules/css-what/lib/commonjs/parse.js
var require_parse = __commonJS({
  "node_modules/css-what/lib/commonjs/parse.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.parse = exports2.isTraversal = void 0;
    var types_1 = require_types();
    var reName = /^[^\\#]?(?:\\(?:[\da-f]{1,6}\s?|.)|[\w\-\u00b0-\uFFFF])+/;
    var reEscape = /\\([\da-f]{1,6}\s?|(\s)|.)/gi;
    var actionTypes = /* @__PURE__ */ new Map([
      [126, types_1.AttributeAction.Element],
      [94, types_1.AttributeAction.Start],
      [36, types_1.AttributeAction.End],
      [42, types_1.AttributeAction.Any],
      [33, types_1.AttributeAction.Not],
      [124, types_1.AttributeAction.Hyphen]
    ]);
    var unpackPseudos = /* @__PURE__ */ new Set([
      "has",
      "not",
      "matches",
      "is",
      "where",
      "host",
      "host-context"
    ]);
    function isTraversal(selector) {
      switch (selector.type) {
        case types_1.SelectorType.Adjacent:
        case types_1.SelectorType.Child:
        case types_1.SelectorType.Descendant:
        case types_1.SelectorType.Parent:
        case types_1.SelectorType.Sibling:
        case types_1.SelectorType.ColumnCombinator:
          return true;
        default:
          return false;
      }
    }
    exports2.isTraversal = isTraversal;
    var stripQuotesFromPseudos = /* @__PURE__ */ new Set(["contains", "icontains"]);
    function funescape(_, escaped, escapedWhitespace) {
      var high = parseInt(escaped, 16) - 65536;
      return high !== high || escapedWhitespace ? escaped : high < 0 ? (
        // BMP codepoint
        String.fromCharCode(high + 65536)
      ) : (
        // Supplemental Plane codepoint (surrogate pair)
        String.fromCharCode(high >> 10 | 55296, high & 1023 | 56320)
      );
    }
    function unescapeCSS(str) {
      return str.replace(reEscape, funescape);
    }
    function isQuote(c) {
      return c === 39 || c === 34;
    }
    function isWhitespace(c) {
      return c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
    }
    function parse2(selector) {
      var subselects = [];
      var endIndex = parseSelector(subselects, "".concat(selector), 0);
      if (endIndex < selector.length) {
        throw new Error("Unmatched selector: ".concat(selector.slice(endIndex)));
      }
      return subselects;
    }
    exports2.parse = parse2;
    function parseSelector(subselects, selector, selectorIndex) {
      var tokens = [];
      function getName(offset) {
        var match = selector.slice(selectorIndex + offset).match(reName);
        if (!match) {
          throw new Error("Expected name, found ".concat(selector.slice(selectorIndex)));
        }
        var name = match[0];
        selectorIndex += offset + name.length;
        return unescapeCSS(name);
      }
      function stripWhitespace(offset) {
        selectorIndex += offset;
        while (selectorIndex < selector.length && isWhitespace(selector.charCodeAt(selectorIndex))) {
          selectorIndex++;
        }
      }
      function readValueWithParenthesis() {
        selectorIndex += 1;
        var start = selectorIndex;
        var counter = 1;
        for (; counter > 0 && selectorIndex < selector.length; selectorIndex++) {
          if (selector.charCodeAt(selectorIndex) === 40 && !isEscaped(selectorIndex)) {
            counter++;
          } else if (selector.charCodeAt(selectorIndex) === 41 && !isEscaped(selectorIndex)) {
            counter--;
          }
        }
        if (counter) {
          throw new Error("Parenthesis not matched");
        }
        return unescapeCSS(selector.slice(start, selectorIndex - 1));
      }
      function isEscaped(pos) {
        var slashCount = 0;
        while (selector.charCodeAt(--pos) === 92)
          slashCount++;
        return (slashCount & 1) === 1;
      }
      function ensureNotTraversal() {
        if (tokens.length > 0 && isTraversal(tokens[tokens.length - 1])) {
          throw new Error("Did not expect successive traversals.");
        }
      }
      function addTraversal(type) {
        if (tokens.length > 0 && tokens[tokens.length - 1].type === types_1.SelectorType.Descendant) {
          tokens[tokens.length - 1].type = type;
          return;
        }
        ensureNotTraversal();
        tokens.push({ type });
      }
      function addSpecialAttribute(name, action2) {
        tokens.push({
          type: types_1.SelectorType.Attribute,
          name,
          action: action2,
          value: getName(1),
          namespace: null,
          ignoreCase: "quirks"
        });
      }
      function finalizeSubselector() {
        if (tokens.length && tokens[tokens.length - 1].type === types_1.SelectorType.Descendant) {
          tokens.pop();
        }
        if (tokens.length === 0) {
          throw new Error("Empty sub-selector");
        }
        subselects.push(tokens);
      }
      stripWhitespace(0);
      if (selector.length === selectorIndex) {
        return selectorIndex;
      }
      loop:
        while (selectorIndex < selector.length) {
          var firstChar = selector.charCodeAt(selectorIndex);
          switch (firstChar) {
            case 32:
            case 9:
            case 10:
            case 12:
            case 13: {
              if (tokens.length === 0 || tokens[0].type !== types_1.SelectorType.Descendant) {
                ensureNotTraversal();
                tokens.push({ type: types_1.SelectorType.Descendant });
              }
              stripWhitespace(1);
              break;
            }
            case 62: {
              addTraversal(types_1.SelectorType.Child);
              stripWhitespace(1);
              break;
            }
            case 60: {
              addTraversal(types_1.SelectorType.Parent);
              stripWhitespace(1);
              break;
            }
            case 126: {
              addTraversal(types_1.SelectorType.Sibling);
              stripWhitespace(1);
              break;
            }
            case 43: {
              addTraversal(types_1.SelectorType.Adjacent);
              stripWhitespace(1);
              break;
            }
            case 46: {
              addSpecialAttribute("class", types_1.AttributeAction.Element);
              break;
            }
            case 35: {
              addSpecialAttribute("id", types_1.AttributeAction.Equals);
              break;
            }
            case 91: {
              stripWhitespace(1);
              var name_1 = void 0;
              var namespace = null;
              if (selector.charCodeAt(selectorIndex) === 124) {
                name_1 = getName(1);
              } else if (selector.startsWith("*|", selectorIndex)) {
                namespace = "*";
                name_1 = getName(2);
              } else {
                name_1 = getName(0);
                if (selector.charCodeAt(selectorIndex) === 124 && selector.charCodeAt(selectorIndex + 1) !== 61) {
                  namespace = name_1;
                  name_1 = getName(1);
                }
              }
              stripWhitespace(0);
              var action = types_1.AttributeAction.Exists;
              var possibleAction = actionTypes.get(selector.charCodeAt(selectorIndex));
              if (possibleAction) {
                action = possibleAction;
                if (selector.charCodeAt(selectorIndex + 1) !== 61) {
                  throw new Error("Expected `=`");
                }
                stripWhitespace(2);
              } else if (selector.charCodeAt(selectorIndex) === 61) {
                action = types_1.AttributeAction.Equals;
                stripWhitespace(1);
              }
              var value = "";
              var ignoreCase = null;
              if (action !== "exists") {
                if (isQuote(selector.charCodeAt(selectorIndex))) {
                  var quote = selector.charCodeAt(selectorIndex);
                  var sectionEnd = selectorIndex + 1;
                  while (sectionEnd < selector.length && (selector.charCodeAt(sectionEnd) !== quote || isEscaped(sectionEnd))) {
                    sectionEnd += 1;
                  }
                  if (selector.charCodeAt(sectionEnd) !== quote) {
                    throw new Error("Attribute value didn't end");
                  }
                  value = unescapeCSS(selector.slice(selectorIndex + 1, sectionEnd));
                  selectorIndex = sectionEnd + 1;
                } else {
                  var valueStart = selectorIndex;
                  while (selectorIndex < selector.length && (!isWhitespace(selector.charCodeAt(selectorIndex)) && selector.charCodeAt(selectorIndex) !== 93 || isEscaped(selectorIndex))) {
                    selectorIndex += 1;
                  }
                  value = unescapeCSS(selector.slice(valueStart, selectorIndex));
                }
                stripWhitespace(0);
                var forceIgnore = selector.charCodeAt(selectorIndex) | 32;
                if (forceIgnore === 115) {
                  ignoreCase = false;
                  stripWhitespace(1);
                } else if (forceIgnore === 105) {
                  ignoreCase = true;
                  stripWhitespace(1);
                }
              }
              if (selector.charCodeAt(selectorIndex) !== 93) {
                throw new Error("Attribute selector didn't terminate");
              }
              selectorIndex += 1;
              var attributeSelector = {
                type: types_1.SelectorType.Attribute,
                name: name_1,
                action,
                value,
                namespace,
                ignoreCase
              };
              tokens.push(attributeSelector);
              break;
            }
            case 58: {
              if (selector.charCodeAt(selectorIndex + 1) === 58) {
                tokens.push({
                  type: types_1.SelectorType.PseudoElement,
                  name: getName(2).toLowerCase(),
                  data: selector.charCodeAt(selectorIndex) === 40 ? readValueWithParenthesis() : null
                });
                continue;
              }
              var name_2 = getName(1).toLowerCase();
              var data = null;
              if (selector.charCodeAt(selectorIndex) === 40) {
                if (unpackPseudos.has(name_2)) {
                  if (isQuote(selector.charCodeAt(selectorIndex + 1))) {
                    throw new Error("Pseudo-selector ".concat(name_2, " cannot be quoted"));
                  }
                  data = [];
                  selectorIndex = parseSelector(data, selector, selectorIndex + 1);
                  if (selector.charCodeAt(selectorIndex) !== 41) {
                    throw new Error("Missing closing parenthesis in :".concat(name_2, " (").concat(selector, ")"));
                  }
                  selectorIndex += 1;
                } else {
                  data = readValueWithParenthesis();
                  if (stripQuotesFromPseudos.has(name_2)) {
                    var quot = data.charCodeAt(0);
                    if (quot === data.charCodeAt(data.length - 1) && isQuote(quot)) {
                      data = data.slice(1, -1);
                    }
                  }
                  data = unescapeCSS(data);
                }
              }
              tokens.push({ type: types_1.SelectorType.Pseudo, name: name_2, data });
              break;
            }
            case 44: {
              finalizeSubselector();
              tokens = [];
              stripWhitespace(1);
              break;
            }
            default: {
              if (selector.startsWith("/*", selectorIndex)) {
                var endIndex = selector.indexOf("*/", selectorIndex + 2);
                if (endIndex < 0) {
                  throw new Error("Comment was not terminated");
                }
                selectorIndex = endIndex + 2;
                if (tokens.length === 0) {
                  stripWhitespace(0);
                }
                break;
              }
              var namespace = null;
              var name_3 = void 0;
              if (firstChar === 42) {
                selectorIndex += 1;
                name_3 = "*";
              } else if (firstChar === 124) {
                name_3 = "";
                if (selector.charCodeAt(selectorIndex + 1) === 124) {
                  addTraversal(types_1.SelectorType.ColumnCombinator);
                  stripWhitespace(2);
                  break;
                }
              } else if (reName.test(selector.slice(selectorIndex))) {
                name_3 = getName(0);
              } else {
                break loop;
              }
              if (selector.charCodeAt(selectorIndex) === 124 && selector.charCodeAt(selectorIndex + 1) !== 124) {
                namespace = name_3;
                if (selector.charCodeAt(selectorIndex + 1) === 42) {
                  name_3 = "*";
                  selectorIndex += 2;
                } else {
                  name_3 = getName(1);
                }
              }
              tokens.push(name_3 === "*" ? { type: types_1.SelectorType.Universal, namespace } : { type: types_1.SelectorType.Tag, name: name_3, namespace });
            }
          }
        }
      finalizeSubselector();
      return selectorIndex;
    }
  }
});

// node_modules/css-what/lib/commonjs/stringify.js
var require_stringify = __commonJS({
  "node_modules/css-what/lib/commonjs/stringify.js"(exports2) {
    "use strict";
    var __spreadArray = exports2 && exports2.__spreadArray || function(to, from, pack) {
      if (pack || arguments.length === 2)
        for (var i = 0, l = from.length, ar; i < l; i++) {
          if (ar || !(i in from)) {
            if (!ar)
              ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
          }
        }
      return to.concat(ar || Array.prototype.slice.call(from));
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.stringify = void 0;
    var types_1 = require_types();
    var attribValChars = ["\\", '"'];
    var pseudoValChars = __spreadArray(__spreadArray([], attribValChars, true), ["(", ")"], false);
    var charsToEscapeInAttributeValue = new Set(attribValChars.map(function(c) {
      return c.charCodeAt(0);
    }));
    var charsToEscapeInPseudoValue = new Set(pseudoValChars.map(function(c) {
      return c.charCodeAt(0);
    }));
    var charsToEscapeInName = new Set(__spreadArray(__spreadArray([], pseudoValChars, true), [
      "~",
      "^",
      "$",
      "*",
      "+",
      "!",
      "|",
      ":",
      "[",
      "]",
      " ",
      "."
    ], false).map(function(c) {
      return c.charCodeAt(0);
    }));
    function stringify(selector) {
      return selector.map(function(token) {
        return token.map(stringifyToken).join("");
      }).join(", ");
    }
    exports2.stringify = stringify;
    function stringifyToken(token, index, arr) {
      switch (token.type) {
        case types_1.SelectorType.Child:
          return index === 0 ? "> " : " > ";
        case types_1.SelectorType.Parent:
          return index === 0 ? "< " : " < ";
        case types_1.SelectorType.Sibling:
          return index === 0 ? "~ " : " ~ ";
        case types_1.SelectorType.Adjacent:
          return index === 0 ? "+ " : " + ";
        case types_1.SelectorType.Descendant:
          return " ";
        case types_1.SelectorType.ColumnCombinator:
          return index === 0 ? "|| " : " || ";
        case types_1.SelectorType.Universal:
          return token.namespace === "*" && index + 1 < arr.length && "name" in arr[index + 1] ? "" : "".concat(getNamespace(token.namespace), "*");
        case types_1.SelectorType.Tag:
          return getNamespacedName(token);
        case types_1.SelectorType.PseudoElement:
          return "::".concat(escapeName(token.name, charsToEscapeInName)).concat(token.data === null ? "" : "(".concat(escapeName(token.data, charsToEscapeInPseudoValue), ")"));
        case types_1.SelectorType.Pseudo:
          return ":".concat(escapeName(token.name, charsToEscapeInName)).concat(token.data === null ? "" : "(".concat(typeof token.data === "string" ? escapeName(token.data, charsToEscapeInPseudoValue) : stringify(token.data), ")"));
        case types_1.SelectorType.Attribute: {
          if (token.name === "id" && token.action === types_1.AttributeAction.Equals && token.ignoreCase === "quirks" && !token.namespace) {
            return "#".concat(escapeName(token.value, charsToEscapeInName));
          }
          if (token.name === "class" && token.action === types_1.AttributeAction.Element && token.ignoreCase === "quirks" && !token.namespace) {
            return ".".concat(escapeName(token.value, charsToEscapeInName));
          }
          var name_1 = getNamespacedName(token);
          if (token.action === types_1.AttributeAction.Exists) {
            return "[".concat(name_1, "]");
          }
          return "[".concat(name_1).concat(getActionValue(token.action), '="').concat(escapeName(token.value, charsToEscapeInAttributeValue), '"').concat(token.ignoreCase === null ? "" : token.ignoreCase ? " i" : " s", "]");
        }
      }
    }
    function getActionValue(action) {
      switch (action) {
        case types_1.AttributeAction.Equals:
          return "";
        case types_1.AttributeAction.Element:
          return "~";
        case types_1.AttributeAction.Start:
          return "^";
        case types_1.AttributeAction.End:
          return "$";
        case types_1.AttributeAction.Any:
          return "*";
        case types_1.AttributeAction.Not:
          return "!";
        case types_1.AttributeAction.Hyphen:
          return "|";
        case types_1.AttributeAction.Exists:
          throw new Error("Shouldn't be here");
      }
    }
    function getNamespacedName(token) {
      return "".concat(getNamespace(token.namespace)).concat(escapeName(token.name, charsToEscapeInName));
    }
    function getNamespace(namespace) {
      return namespace !== null ? "".concat(namespace === "*" ? "*" : escapeName(namespace, charsToEscapeInName), "|") : "";
    }
    function escapeName(str, charsToEscape) {
      var lastIdx = 0;
      var ret = "";
      for (var i = 0; i < str.length; i++) {
        if (charsToEscape.has(str.charCodeAt(i))) {
          ret += "".concat(str.slice(lastIdx, i), "\\").concat(str.charAt(i));
          lastIdx = i + 1;
        }
      }
      return ret.length > 0 ? ret + str.slice(lastIdx) : str;
    }
  }
});

// node_modules/css-what/lib/commonjs/index.js
var require_commonjs = __commonJS({
  "node_modules/css-what/lib/commonjs/index.js"(exports2) {
    "use strict";
    var __createBinding = exports2 && exports2.__createBinding || (Object.create ? function(o, m, k, k2) {
      if (k2 === void 0)
        k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    } : function(o, m, k, k2) {
      if (k2 === void 0)
        k2 = k;
      o[k2] = m[k];
    });
    var __exportStar = exports2 && exports2.__exportStar || function(m, exports3) {
      for (var p in m)
        if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p))
          __createBinding(exports3, m, p);
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.stringify = exports2.parse = exports2.isTraversal = void 0;
    __exportStar(require_types(), exports2);
    var parse_1 = require_parse();
    Object.defineProperty(exports2, "isTraversal", { enumerable: true, get: function() {
      return parse_1.isTraversal;
    } });
    Object.defineProperty(exports2, "parse", { enumerable: true, get: function() {
      return parse_1.parse;
    } });
    var stringify_1 = require_stringify();
    Object.defineProperty(exports2, "stringify", { enumerable: true, get: function() {
      return stringify_1.stringify;
    } });
  }
});

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode2 = __toESM(require("vscode"));

// src/parser.ts
var SEPARATORS = [
  { sep: "#$#", type: "snippet" },
  { sep: "#?#", type: "extended" },
  { sep: "#@#", type: "hiding-exception" },
  { sep: "##", type: "cosmetic" }
];
function parseLine(raw, lineIndex) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("!") || trimmed.startsWith("[Adblock")) {
    return { type: "comment", domains: [], body: trimmed, separator: "!", raw, lineIndex, bodyOffset: 0 };
  }
  if (trimmed.length === 0) {
    return { type: "unknown", domains: [], body: "", separator: "", raw, lineIndex, bodyOffset: 0 };
  }
  if (trimmed.startsWith("@@")) {
    return { type: "exception", domains: [], body: trimmed.slice(2), separator: "@@", raw, lineIndex, bodyOffset: 2 };
  }
  for (const { sep, type } of SEPARATORS) {
    const idx = trimmed.indexOf(sep);
    if (idx !== -1) {
      const domainStr = trimmed.slice(0, idx);
      const body = trimmed.slice(idx + sep.length);
      const domains = domainStr ? domainStr.split(",").map((d) => d.trim()).filter(Boolean) : [];
      const bodyOffset = raw.indexOf(sep) + sep.length;
      return { type, domains, body, separator: sep, raw, lineIndex, bodyOffset };
    }
  }
  return {
    type: "network",
    domains: [],
    body: trimmed,
    separator: "",
    raw,
    lineIndex,
    bodyOffset: 0
  };
}
function isAbpDocument(lines) {
  return lines.some(
    (l) => l.includes("##") || l.includes("#$#") || l.includes("#?#") || l.includes("||") || l.startsWith("@@")
  );
}

// src/data/snippets.json
var snippets_default = {
  snippets: {
    "abort-current-inline-script": {
      since: "3.4.3",
      args: [
        { name: "api", required: true },
        { name: "search", required: false }
      ]
    },
    "abort-on-property-read": {
      since: "3.4.1",
      args: [
        { name: "property", required: true },
        { name: "setConfigurable", required: false }
      ]
    },
    "abort-on-property-write": {
      since: "3.4.3",
      args: [
        { name: "property", required: true },
        { name: "setConfigurable", required: false }
      ]
    },
    "abort-on-iframe-property-read": {
      since: "3.10.1",
      args: [
        { name: "properties", required: true, variadic: true }
      ]
    },
    "abort-on-iframe-property-write": {
      since: "3.10.1",
      args: [
        { name: "properties", required: true, variadic: true }
      ]
    },
    "array-override": {
      since: "4.8",
      args: [
        { name: "method", required: true, enum: ["push", "includes", "forEach"] },
        { name: "needle", required: true },
        { name: "returnValue", required: false },
        { name: "path", required: false },
        { name: "stack", required: false }
      ]
    },
    "blob-override": {
      since: "4.22.2",
      args: [
        { name: "search", required: true },
        { name: "replacement", required: false },
        { name: "needle", required: false }
      ]
    },
    "cookie-remover": {
      since: "3.11.2",
      args: [
        { name: "cookie", required: true },
        { name: "autoRemoveCookie", required: false }
      ]
    },
    "event-override": {
      since: "4.22.2",
      args: [
        { name: "eventType", required: true },
        { name: "mode", required: true, enum: ["trusted", "disable"] },
        { name: "needle", required: false }
      ]
    },
    "freeze-element": {
      since: "3.10",
      args: [
        { name: "selector", required: true },
        { name: "options", required: false },
        { name: "exceptions", required: false }
      ]
    },
    "json-override": {
      since: "3.11.2",
      args: [
        { name: "rawOverridePaths", required: true },
        { name: "value", required: true, enum: ["undefined", "false", "true", "null", "''", "noopFunc", "trueFunc", "falseFunc", "throwFunc", "noopCallbackFunc", "noopthis", "noopnull", "nooparr", "noopobj", "noopstr"] },
        { name: "rawNeedlePaths", required: false },
        { name: "filter", required: false }
      ]
    },
    "json-prune": {
      since: "3.9.0",
      args: [
        { name: "rawPrunePaths", required: true },
        { name: "rawNeedlePaths", required: false },
        { name: "rawNeedleStack", required: false }
      ]
    },
    "map-override": {
      since: "4.24.0",
      args: [
        { name: "method", required: true, enum: ["set", "get", "has"] },
        { name: "needle", required: true },
        { name: "returnValue", required: false },
        { name: "path", required: false },
        { name: "stack", required: false }
      ]
    },
    "override-property-read": {
      since: "3.9.4",
      args: [
        { name: "property", required: true },
        { name: "value", required: true, enum: ["undefined", "false", "true", "null", "''", "noopFunc", "trueFunc", "falseFunc", "throwFunc", "noopCallbackFunc", "noopthis", "noopnull", "nooparr", "noopobj", "noopstr"] },
        { name: "setConfigurable", required: false }
      ]
    },
    "prevent-listener": {
      since: "3.11.2",
      args: [
        { name: "type", required: true },
        { name: "handler", required: false },
        { name: "selector", required: false }
      ]
    },
    "prevent-element-src-loading": {
      since: "4.35.1",
      args: [
        { name: "tagName", required: true, enum: ["script", "img", "iframe", "link"] },
        { name: "search", required: true }
      ]
    },
    "replace-fetch-response": {
      since: "4.4",
      args: [
        { name: "search", required: true },
        { name: "replacement", required: false },
        { name: "needle", required: false }
      ]
    },
    "replace-outbound-value": {
      since: "4.26.0",
      args: [
        { name: "method", required: true },
        { name: "search", required: true },
        { name: "replacement", required: false },
        { name: "decodeMethod", required: false },
        { name: "path", required: false },
        { name: "stack", required: false }
      ]
    },
    "replace-xhr-response": {
      since: "4.4",
      args: [
        { name: "search", required: true },
        { name: "replacement", required: false },
        { name: "needle", required: false }
      ]
    },
    "simulate-mouse-event": {
      since: "3.17",
      args: [
        { name: "selectors", required: true, variadic: true, max: 7 }
      ]
    },
    "skip-video": {
      since: "3.21",
      args: [
        { name: "playerSelector", required: true },
        { name: "xpathCondition", required: true }
      ]
    },
    "strip-fetch-query-parameter": {
      since: "3.5.1",
      args: [
        { name: "name", required: true },
        { name: "urlPattern", required: false }
      ]
    },
    "hide-if-canvas-contains": {
      since: "4.7",
      category: "conditional-hiding",
      noRace: true,
      args: [
        { name: "search", required: true },
        { name: "selector", required: false }
      ]
    },
    "hide-if-contains": {
      since: "3.3",
      category: "conditional-hiding",
      args: [
        { name: "search", required: true },
        { name: "selector", required: true },
        { name: "searchSelector", required: false }
      ]
    },
    "hide-if-contains-and-matches-style": {
      since: "3.3.2",
      category: "conditional-hiding",
      args: [
        { name: "search", required: true },
        { name: "selector", required: true },
        { name: "searchSelector", required: false },
        { name: "style", required: false },
        { name: "searchStyle", required: false },
        { name: "waitUntil", required: false },
        { name: "windowWidthMin", required: false },
        { name: "windowWidthMax", required: false }
      ]
    },
    "hide-if-contains-image": {
      since: "3.4.2",
      category: "conditional-hiding",
      args: [
        { name: "search", required: true },
        { name: "selector", required: true },
        { name: "searchSelector", required: false }
      ]
    },
    "hide-if-contains-similar-text": {
      since: "3.14.2",
      category: "conditional-hiding",
      args: [
        { name: "search", required: true },
        { name: "selector", required: true },
        { name: "searchSelector", required: false }
      ]
    },
    "hide-if-contains-visible-text": {
      since: "3.6",
      category: "conditional-hiding",
      noSvg: true,
      args: [
        { name: "search", required: true },
        { name: "selector", required: true },
        { name: "searchSelector", required: false }
      ]
    },
    "hide-if-has-and-matches-style": {
      since: "3.4.2",
      category: "conditional-hiding",
      noShadowInSearch: true,
      args: [
        { name: "search", required: true },
        { name: "selector", required: true },
        { name: "searchSelector", required: false },
        { name: "style", required: false },
        { name: "searchStyle", required: false },
        { name: "waitUntil", required: false },
        { name: "windowWidthMin", required: false },
        { name: "windowWidthMax", required: false }
      ]
    },
    "hide-if-labelled-by": {
      since: "3.9",
      category: "conditional-hiding",
      args: [
        { name: "search", required: true },
        { name: "selector", required: true },
        { name: "searchSelector", required: false }
      ]
    },
    "hide-if-matches-computed-xpath": {
      since: "3.18.1",
      category: "conditional-hiding",
      args: [
        { name: "query", required: true },
        { name: "searchQuery", required: true },
        { name: "searchRegex", required: true },
        { name: "waitUntil", required: false }
      ]
    },
    "hide-if-matches-xpath": {
      since: "3.9.0",
      category: "conditional-hiding",
      args: [
        { name: "query", required: true },
        { name: "scopeQuery", required: false },
        { name: "waitUntil", required: false }
      ]
    },
    "hide-if-matches-xpath3": {
      since: "3.19",
      category: "conditional-hiding",
      args: [
        { name: "query", required: true },
        { name: "scopeQuery", required: false }
      ]
    },
    "hide-if-shadow-contains": {
      since: "3.3",
      category: "conditional-hiding",
      args: [
        { name: "search", required: true },
        { name: "selector", required: true }
      ]
    },
    "hide-if-svg-contains": {
      since: "4.26.0",
      category: "conditional-hiding",
      args: [
        { name: "search", required: true },
        { name: "selector", required: true },
        { name: "searchSelector", required: false }
      ]
    },
    debug: {
      since: "3.8",
      category: "debugging",
      args: []
    },
    log: {
      since: "3.3",
      category: "debugging",
      args: [
        { name: "messages", required: false, variadic: true }
      ]
    },
    trace: {
      since: "3.3",
      category: "debugging",
      args: [
        { name: "messages", required: false, variadic: true }
      ]
    },
    profile: {
      since: "4.8",
      category: "debugging",
      args: []
    },
    race: {
      since: "3.14.1",
      category: "performance",
      args: []
    }
  },
  deprecated: {
    "simulate-event-poc": "Replaced by simulate-mouse-event",
    "hide-if-classifies": "Removed in @eyeo/snippets v2.0.0 \u2014 requires service worker backend",
    "hide-if-graph-matches": "Removed in @eyeo/snippets v0.9.0 \u2014 ML snippet requiring external dependency"
  }
};

// src/validators/snippets.ts
var SNIPPETS = snippets_default.snippets;
var DEPRECATED = snippets_default.deprecated;
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from(
    { length: m + 1 },
    (_, i) => Array.from({ length: n + 1 }, (_2, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
function findClosest(name) {
  const candidates = Object.keys(SNIPPETS);
  let best = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = levenshtein(name, c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return bestDist <= 3 ? best : null;
}
function parseSnippetArgs(body) {
  const args = [];
  let current = "";
  let inQuote = false;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length) {
      current += body[i + 1];
      i += 2;
      continue;
    }
    if (ch === "'" && !inQuote) {
      inQuote = true;
      i++;
      continue;
    }
    if (ch === "'" && inQuote) {
      inQuote = false;
      i++;
      continue;
    }
    if (ch === " " && !inQuote) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (current.length > 0)
    args.push(current);
  return args;
}
function splitSnippetChain(body) {
  const calls = [];
  const parts = body.split(";");
  let offset = 0;
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      offset += part.length + 1;
      continue;
    }
    const spaceIdx = trimmed.indexOf(" ");
    const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const argBody = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);
    const args = argBody ? parseSnippetArgs(argBody) : [];
    const nameOffset = body.indexOf(trimmed, offset);
    calls.push({ name, args, nameOffset });
    offset += part.length + 1;
  }
  return calls;
}
function validateSnippetCall(call, bodyOffset) {
  const results = [];
  const { name, args, nameOffset } = call;
  const absStart = bodyOffset + nameOffset;
  const absEnd = absStart + name.length;
  if (DEPRECATED[name]) {
    results.push({
      message: `Deprecated snippet "${name}": ${DEPRECATED[name]}`,
      severity: "warning",
      startCol: absStart,
      endCol: absEnd
    });
    return results;
  }
  if (!SNIPPETS[name]) {
    const suggestion = findClosest(name);
    results.push({
      message: suggestion ? `Unknown snippet "${name}". Did you mean "${suggestion}"?` : `Unknown snippet "${name}"`,
      severity: "error",
      startCol: absStart,
      endCol: absEnd
    });
    return results;
  }
  const schema = SNIPPETS[name];
  const requiredArgs = schema.args.filter((a) => a.required);
  if (args.length < requiredArgs.length) {
    results.push({
      message: `"${name}" requires ${requiredArgs.length} argument(s) but got ${args.length}`,
      severity: "warning",
      startCol: absStart,
      endCol: absEnd
    });
  }
  let argSearchOffset = bodyOffset + nameOffset + name.length + 1;
  for (let i = 0; i < schema.args.length; i++) {
    const argSchema = schema.args[i];
    const argVal = args[i];
    if (argVal === void 0)
      break;
    if (argSchema.enum && !argSchema.enum.includes(argVal)) {
      results.push({
        message: `Invalid value "${argVal}" for "${argSchema.name}". Expected one of: ${argSchema.enum.join(", ")}`,
        severity: "error",
        startCol: argSearchOffset,
        endCol: argSearchOffset + argVal.length
      });
    }
    argSearchOffset += argVal.length + 1;
  }
  return results;
}

// src/data/modifiers.json
var modifiers_default = {
  valid: [
    "script",
    "image",
    "stylesheet",
    "subdocument",
    "xmlhttprequest",
    "websocket",
    "popup",
    "font",
    "media",
    "match-case",
    "document",
    "elemhide",
    "generichide",
    "genericblock",
    "third-party",
    "csp",
    "domain",
    "rewrite",
    "header",
    "addheader"
  ],
  valueRequired: ["csp", "domain", "rewrite"],
  rewritePrefix: "abp-resource:",
  exceptionOnly: ["elemhide", "generichide", "genericblock"],
  contentTypes: [
    "script",
    "image",
    "stylesheet",
    "subdocument",
    "xmlhttprequest",
    "websocket",
    "popup",
    "font",
    "media"
  ],
  incompatible: {
    document: [
      "script",
      "image",
      "stylesheet",
      "subdocument",
      "xmlhttprequest",
      "websocket",
      "popup",
      "font",
      "media"
    ]
  }
};

// src/validators/network.ts
var VALID = new Set(modifiers_default.valid);
var VALUE_REQUIRED = new Set(modifiers_default.valueRequired);
var EXCEPTION_ONLY = new Set(modifiers_default.exceptionOnly);
var INCOMPATIBLE = modifiers_default.incompatible;
function validateNetworkRule(body, isException, bodyOffset) {
  const results = [];
  const dollarIdx = body.lastIndexOf("$");
  if (dollarIdx === -1)
    return results;
  const modifierStr = body.slice(dollarIdx + 1);
  const modifiers = modifierStr.split(",");
  const modifierNames = [];
  let modRunningOffset = 0;
  for (const mod of modifiers) {
    const trimmedMod = mod.trim();
    const negated = trimmedMod.startsWith("~");
    const raw = negated ? trimmedMod.slice(1) : trimmedMod;
    const [key, value] = raw.split("=");
    const modStart = bodyOffset + dollarIdx + 1 + modRunningOffset;
    const modEnd = modStart + trimmedMod.length;
    modRunningOffset += mod.length + 1;
    if (!VALID.has(key)) {
      results.push({
        message: `Unknown modifier "${key}"`,
        severity: "error",
        startCol: modStart,
        endCol: modEnd
      });
      continue;
    }
    if (!negated && EXCEPTION_ONLY.has(key) && !isException) {
      results.push({
        message: `"${key}" is only valid on exception rules (@@)`,
        severity: "error",
        startCol: modStart,
        endCol: modEnd
      });
    }
    if (!negated && VALUE_REQUIRED.has(key)) {
      if (!value || value.trim() === "") {
        results.push({
          message: `Modifier "${key}" requires a value (e.g. ${key}=...)`,
          severity: "error",
          startCol: modStart,
          endCol: modEnd
        });
      } else if (key === "rewrite" && !value.startsWith(modifiers_default.rewritePrefix)) {
        results.push({
          message: `"rewrite" value must start with "${modifiers_default.rewritePrefix}"`,
          severity: "error",
          startCol: modStart,
          endCol: modEnd
        });
      }
    }
    modifierNames.push(key);
  }
  for (const [mod, incompatibles] of Object.entries(INCOMPATIBLE)) {
    if (!modifierNames.includes(mod))
      continue;
    for (const inc of incompatibles) {
      if (modifierNames.includes(inc)) {
        results.push({
          message: `"${mod}" cannot be combined with "${inc}"`,
          severity: "error",
          startCol: bodyOffset + dollarIdx,
          endCol: bodyOffset + body.length
        });
      }
    }
  }
  return results;
}

// src/validators/cosmetic.ts
var parse = null;
async function getParser() {
  if (!parse) {
    const cssWhat = await Promise.resolve().then(() => __toESM(require_commonjs()));
    parse = cssWhat.parse;
  }
  return parse;
}
async function validateCosmeticSelector(selector, bodyOffset) {
  const results = [];
  if (!selector.trim())
    return results;
  try {
    const p = await getParser();
    p(selector);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid CSS selector";
    results.push({
      message: `Malformed CSS selector: ${msg}`,
      severity: "warning",
      startCol: bodyOffset,
      endCol: bodyOffset + selector.length
    });
  }
  return results;
}

// src/validators/extended.ts
var VALID_ABP_PSEUDOS = /* @__PURE__ */ new Set([
  ":-abp-has",
  ":-abp-contains",
  ":-abp-properties",
  ":xpath"
]);
function validateExtendedSelector(selector, bodyOffset) {
  const results = [];
  const pseudoRegex = /:[-\w]+\(/g;
  let match;
  while ((match = pseudoRegex.exec(selector)) !== null) {
    const token = match[0].slice(0, -1);
    if (token.startsWith(":-abp-") && !VALID_ABP_PSEUDOS.has(token)) {
      const start = bodyOffset + match.index;
      results.push({
        message: `Unknown ABP pseudo-class "${token}()"`,
        severity: "error",
        startCol: start,
        endCol: start + token.length
      });
    }
  }
  return results;
}

// src/diagnostics.ts
var vscode = __toESM(require("vscode"));
function toDiagnostic(result, lineIndex, doc) {
  const line = doc.lineAt(lineIndex);
  const start = new vscode.Position(lineIndex, Math.min(result.startCol, line.text.length));
  const end = new vscode.Position(lineIndex, Math.min(result.endCol, line.text.length));
  const range = new vscode.Range(start, end);
  const severity = result.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
  const diagnostic = new vscode.Diagnostic(range, result.message, severity);
  diagnostic.source = "abp-filter-linter";
  return diagnostic;
}

// src/extension.ts
var COLLECTION_NAME = "abp-filter-linter";
function activate(context) {
  const collection = vscode2.languages.createDiagnosticCollection(COLLECTION_NAME);
  context.subscriptions.push(collection);
  const lint = async (doc) => {
    if (doc.languageId !== "plaintext")
      return;
    const lines = doc.getText().split("\n");
    if (!isAbpDocument(lines)) {
      collection.delete(doc.uri);
      return;
    }
    const diagnostics = [];
    for (let i = 0; i < lines.length; i++) {
      const parsed = parseLine(lines[i], i);
      const results = [];
      if (parsed.type === "comment" || parsed.type === "unknown")
        continue;
      if (parsed.type === "snippet") {
        const calls = splitSnippetChain(parsed.body);
        for (const call of calls) {
          results.push(...validateSnippetCall(call, parsed.bodyOffset));
        }
      }
      if (parsed.type === "network" || parsed.type === "exception") {
        results.push(
          ...validateNetworkRule(parsed.body, parsed.type === "exception", parsed.bodyOffset)
        );
      }
      if (parsed.type === "cosmetic") {
        const cosmeticResults = await validateCosmeticSelector(parsed.body, parsed.bodyOffset);
        results.push(...cosmeticResults);
      }
      if (parsed.type === "extended") {
        results.push(...validateExtendedSelector(parsed.body, parsed.bodyOffset));
      }
      for (const r of results) {
        diagnostics.push(toDiagnostic(r, i, doc));
      }
    }
    collection.set(doc.uri, diagnostics);
  };
  context.subscriptions.push(
    vscode2.workspace.onDidOpenTextDocument(lint),
    vscode2.workspace.onDidChangeTextDocument((e) => lint(e.document)),
    vscode2.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri))
  );
  vscode2.workspace.textDocuments.forEach(lint);
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
