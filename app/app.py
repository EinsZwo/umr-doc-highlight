import streamlit as st

from enum import Enum

class Direction(Enum):
    LEFT = 'LEFT'
    RIGHT = 'RIGHT'
    BOTH = 'BOTH'
def add_item(item_index):
    with st.form(key=f'item_form_{item_index}', clear_on_submit=False):
        st.subheader(f"Item {item_index + 1}")

        # Direction field
        direction = st.selectbox(
            "Direction",
            options=[Direction.LEFT.value, Direction.RIGHT.value, Direction.BOTH.value],
            key=f'direction_{item_index}'
        )

        # Source field
        source = st.text_input("Source (leave blank to configure complex input)", key=f'source_{item_index}')

        # Complex source input
        source_complex = st.checkbox("Configure complex source", key=f'source_complex_{item_index}')
        if source_complex:
            source = configure_complex_input(f'source_{item_index}')

        # Target field
        target = st.text_input("Target (leave blank to configure complex input)", key=f'target_{item_index}')

        # Complex target input
        target_complex = st.checkbox("Configure complex target", key=f'target_complex_{item_index}')
        if target_complex:
            target = configure_complex_input(f'target_{item_index}')

        submitted = st.form_submit_button("Submit")

        if submitted:
            return {
                'direction': direction,
                'source': source,
                'target': target
            }

def configure_complex_input(prefix):
    components = []
    num_components = st.number_input(
        f"Number of components for {prefix}",
        min_value=1,
        step=1,
        key=f'num_components_{prefix}'
    )

    for i in range(int(num_components)):
        component_type = st.selectbox(
            f"Component Type {i + 1}",
            options=['String', 'Property Comparison'],
            key=f'component_type_{prefix}_{i}'
        )

        if component_type == 'String':
            value = st.text_input(
                f"String Value {i + 1}",
                key=f'string_value_{prefix}_{i}'
            )
            components.append(value)
        else:
            prop_key = st.text_input(
                f"Property Key {i + 1}",
                key=f'prop_key_{prefix}_{i}'
            )
            comparison = st.selectbox(
                f"Comparison {i + 1}",
                options=['equals', 'less than', 'greater than'],
                key=f'comparison_{prefix}_{i}'
            )
            prop_value = st.text_input(
                f"Property Value {i + 1}",
                key=f'prop_value_{prefix}_{i}'
            )
            components.append({
                'property_key': prop_key,
                'comparison': comparison,
                'value': prop_value
            })
    return components

def main():
    st.title("Configure Items")

    items = []
    num_items = st.number_input("Number of items to configure", min_value=1, step=1, key='num_items')

    for item_index in range(int(num_items)):
        item = add_item(item_index)
        if item:
            items.append(item)

    if st.button("Finalize Configuration"):
        st.write("Final Configuration:")
        st.json(items)

if __name__ == "__main__":
    main()
