GROUPS = [
    "Unspecified", "American", "Pizza", "Mexican", "Fast Food", "Sandwiches & Delis",
    "BBQ", "Italian", "Burgers", "Seafood", "Diners", "Chinese", "Japanese", "Thai",
    "Vietnamese", "Korean", "Other Asian", "Chicken & Wings", "Latin & Caribbean",
    "Steakhouses", "Indian & South Asian", "Mediterranean & Middle Eastern",
    "Southern & Cajun", "Vegetarian & Health", "European", "Other",
]

L3 = {
    "": 0, "Restaurant": 0, "American Restaurant": 1, "Pizzeria": 2, "Mexican Restaurant": 3,
    "Fast Food Restaurant": 4, "Sandwich Spot": 5, "Deli": 5, "BBQ Joint": 6,
    "Italian Restaurant": 7, "Burger Joint": 8, "Seafood Restaurant": 9, "Diner": 10,
    "Fried Chicken Joint": 17, "Wings Joint": 17, "Latin American Restaurant": 18,
    "Caribbean Restaurant": 18, "Steakhouse": 19, "Indian Restaurant": 20,
    "Pakistani Restaurant": 20, "Bangladeshi Restaurant": 20, "Sri Lankan Restaurant": 20,
    "Indian Chinese Restaurant": 20, "Mediterranean Restaurant": 21, "Greek Restaurant": 21,
    "Middle Eastern Restaurant": 21, "Turkish Restaurant": 21, "Falafel Restaurant": 21,
    "Kebab Restaurant": 21, "Halal Restaurant": 21, "Moroccan Restaurant": 21,
    "Afghan Restaurant": 21, "Armenian Restaurant": 21, "Southern Food Restaurant": 22,
    "Cajun and Creole Restaurant": 22, "Comfort Food Restaurant": 22, "Soup Spot": 22,
    "Vegan and Vegetarian Restaurant": 23, "Salad Restaurant": 23, "Gluten-Free Restaurant": 23,
    "French Restaurant": 24, "German Restaurant": 24, "Spanish Restaurant": 24,
    "Eastern European Restaurant": 24, "Portuguese Restaurant": 24, "Polish Restaurant": 24,
    "Modern European Restaurant": 24, "Scandinavian Restaurant": 24, "English Restaurant": 24,
    "Russian Restaurant": 24, "Swiss Restaurant": 24, "Belgian Restaurant": 24,
    "Ukrainian Restaurant": 24, "Hungarian Restaurant": 24, "Dutch Restaurant": 24,
    "Austrian Restaurant": 24, "Czech Restaurant": 24, "Scottish Restaurant": 24,
    "Slovak Restaurant": 24, "Irish Restaurant": 24, "Fondue Restaurant": 24,
}

L4_ASIAN = {
    "Chinese Restaurant": 11, "Japanese Restaurant": 12, "Thai Restaurant": 13,
    "Vietnamese Restaurant": 14, "Korean Restaurant": 15,
}


def group( label ):
    parts = label.split( " > " )
    l3 = parts[2] if len( parts ) > 2 else ""
    if l3 == "Asian Restaurant":
        l4 = parts[3] if len( parts ) > 3 else ""
        return L4_ASIAN.get( l4, 16 )
    return L3.get( l3, 25 )
