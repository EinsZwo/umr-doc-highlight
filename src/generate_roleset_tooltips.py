import xml.etree.ElementTree as ET
import re
import os
import json


def convert_roleset_to_markdown(xml_data):
    root = ET.fromstring(xml_data)
    roleset_id = root.attrib.get('id', '').replace(".", "-")
    roleset_name = root.attrib.get('name', '')

    markdown_lines = []

    # Header: roleset id
    markdown_lines.append(f"## {roleset_id}")

    # Subheader: roleset name
    markdown_lines.append(f"### {roleset_name}")
    markdown_lines.append("")

    # Aliases
    aliases = root.find('aliases')
    if aliases is not None and len(aliases):
        markdown_lines.append("#### Aliases")
        alias_entries = []
        max_alias_length = 0

        for alias in aliases.findall('alias'):
            alias_text = alias.text or ''
            alias_pos = alias.attrib.get('pos', '')
            alias_entries.append((alias_text, alias_pos))
            if len(alias_text) > max_alias_length:
                max_alias_length = len(alias_text)

        for alias_text, alias_pos in alias_entries:
            padding = ' ' * (max_alias_length - len(alias_text))
            markdown_lines.append(f"- {alias_text}{padding}  (*{alias_pos}*)")

        markdown_lines.append("")

    # Roles
    roles = root.find('roles')
    if roles is not None and len(roles):
        markdown_lines.append("### Roles")
        for role in roles.findall('role'):
            n = role.attrib.get('n', '')
            arg_label = f"**ARG{n}**"
            descr = role.attrib.get('descr', '')
            f = role.attrib.get('f', '')
            # Italicize content in parentheses
            descr = re.sub(r'\((.*?)\)', r'(*\1*)', descr)
            f_str = f"(*{f}*)" if f else ''
            # Combine descr and f
            role_line = f"{arg_label}: {descr} {f_str}".strip()
            markdown_lines.append(f"- {role_line}")
        markdown_lines.append("")

    # Combine all markdown lines into a single string
    markdown_str = "\n".join(markdown_lines)
    return markdown_str

def process_rolesets(xml_data, tooltips):
    root = ET.fromstring(xml_data)
    for roleset in root.findall('.//roleset'):
        roleset_id = roleset.attrib.get('id', '').replace(".","-")
        # Convert roleset element to string
        roleset_xml = ET.tostring(roleset, encoding='unicode')
        markdown_str = convert_roleset_to_markdown(roleset_xml)
        tooltips[roleset_id] = markdown_str
    return tooltips


def main():
    tooltips = {}
    dir = "../frames"
    for file in os.listdir(dir):
        if not file.endswith('.xml'):
            continue
        with open(os.path.join(dir, file), 'r', encoding='utf-8') as infile:
            text = "\n".join(infile.readlines()[2:])
            process_rolesets(text, tooltips)

    with open("../data/tooltips.json", 'w+', encoding='utf-8') as outfile:
        json.dump(tooltips, outfile, ensure_ascii=False, indent=4)


if __name__ == "__main__":
    main()