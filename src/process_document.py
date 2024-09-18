import sys
import re
import penman
import json

def extract_graphs(text, subtype="sentence"):
    # Regular expression to match text between "# sentence level graph:" and the next "#"
    pattern = rf"# {subtype} level graph:(.*?)(?=(#|\n-|\Z))"

    matches = re.findall(pattern, text, re.DOTALL)

    return [match[0].strip() for match in matches]


def process_input_document(document):
    snt_graphs = extract_graphs(document, "sentence")
    #document_graphs = extract_graphs(document, "document")
    word_cache = {}

    for snt in snt_graphs:
        try:
            decoded = penman.decode(snt)
            for instance in decoded.instances():
                inst_name = instance[0]
                if inst_name not in word_cache:
                    word_cache[inst_name] = snt

            #word_cache[top] = snt
        except:
            pass



    return word_cache



if __name__ == "__main__":
    print("building tooltips for umr document...", file=sys.stderr)

    document_text = sys.stdin.read()
    result = process_input_document(document_text)
    print(json.dumps(result))
    print("Successfully made tooltips", file=sys.stderr)


