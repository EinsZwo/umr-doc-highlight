from process_document import *

def main():
    with open("test_data.txt", 'r') as infile:
        lines = infile.readlines()

    text = "\n".join(lines)

    process_input_document(text)


if __name__ == "__main__":
    main()