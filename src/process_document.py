import sys
import re
import penman
import json

def extract_graphs(text, subtype="sentence"):
    pattern = rf"# {subtype} level graph:(.*?)(?=(#|\n-|\Z))"

    matches = re.findall(pattern, text, re.DOTALL)

    return [match[0].strip() for match in matches]


def clean_token_labels(text):
    pattern = r"^#tk(\s*\d+)+\s*$"
    cleaned_text = re.sub(pattern, "", text, flags=re.MULTILINE)
    
    return cleaned_text

def extract_sentence_and_glosses(text):
    pattern = r"(# :: snt \d+.*?)# sentence level graph:(.*?)(?=#|\Z)"

    matches = re.findall(pattern, text, re.DOTALL)
    sub_pattern = r"#\S*\s*"

    return [(re.sub(sub_pattern, "", clean_token_labels(header.strip())), graph.strip()) for header, graph in matches]


def preprocess_glosses(gloss_tiers):
    
    if not gloss_tiers:
        return [""]
    
    split_text = [line.split() for line in gloss_tiers]

    column_widths = [0] * len(split_text[0])

    for line in split_text:
        for x, word in enumerate(line):
            column_widths[x] = max(column_widths[x], len(word))

    return split_text, column_widths




def process_input_document(document):
    snt_graphs = extract_sentence_and_glosses(document)

    word_cache = {}
    
    for gloss, graph in snt_graphs:
        try:
            decoded = penman.decode(graph)
            for instance in decoded.instances():
                inst_name = instance[0]
                if inst_name not in word_cache:
                    # TODO: way to make this more robust to different ways glosses might appear?
                    gloss = re.sub(r'\n+', '\n', gloss)

                    gloss_lines = gloss.split("\n")
                    first_snt = gloss_lines[0:2]
                    middle = gloss_lines[2:-1]
                    last_snt = gloss_lines[-1]

                    split_text, column_widths = preprocess_glosses(middle)

                    word_cache[inst_name] = (first_snt, split_text, column_widths, last_snt, graph)

            #word_cache[top] = snt
        except:
            pass

    doc_graphs = extract_graphs(document, "document")

    for doc_graph in doc_graphs:
        try:
            decoded = penman.decode(doc_graph)
            for instance in decoded.instances():
                inst_name = instance[0]
                if inst_name not in word_cache:
                    word_cache[inst_name] = doc_graph
        except:
            pass

    return word_cache


if __name__ == "__main__":
    print("building tooltips for umr document...", file=sys.stderr)

    document_text = sys.stdin.read()
    result = process_input_document(document_text)
    print(json.dumps(result))
    print("Successfully made tooltips", file=sys.stderr)


