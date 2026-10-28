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


import re

NAME_RULES = [
    ( r"\b(pizza|pizzeria|pizzas)\b", 2 ),
    ( r"\b(taco|tacos|taqueria|mexican|burrito|burritos|cantina|carniceria|tortilleria|mariscos|birria|pupuseria|antojitos|tortas|cocina|el pollo|los|las)\b", 3 ),
    ( r"\b(sushi|japanese|ramen|hibachi|teriyaki|izakaya|yakitori|poke|bento|tempura)\b", 12 ),
    ( r"\b(china|chinese|wok|szechuan|sichuan|hunan|cantonese|dim sum|peking|panda|dumpling|dumplings|noodle|noodles|hot pot|shanghai|mandarin|chow)\b", 11 ),
    ( r"\b(thai|pad thai|bangkok|siam)\b", 13 ),
    ( r"\b(pho|vietnamese|banh mi|saigon)\b", 14 ),
    ( r"\b(korean|bibimbap|kbbq|k-bbq|bulgogi|seoul|tofu house)\b", 15 ),
    ( r"\b(indian|curry|tandoori|tandoor|biryani|masala|bombay|punjabi|nepali|himalayan|pakistani|halal)\b", 20 ),
    ( r"\b(bbq|bar-b-q|bar-b-que|barbecue|barbeque|smokehouse|smoke house|rib|ribs|brisket)\b", 6 ),
    ( r"\b(wings|wing|chicken|pollo|fried chicken|chick|hen house)\b", 17 ),
    ( r"\b(burger|burgers|hamburger|hamburgers)\b", 8 ),
    ( r"\b(seafood|fish|oyster|oysters|crab|crabs|shrimp|lobster|clam|clams|mariscos|catfish|cajun seafood)\b", 9 ),
    ( r"\b(steak|steakhouse|steaks|chophouse|chop house|prime rib)\b", 19 ),
    ( r"\b(deli|delicatessen|sandwich|sandwiches|subs|sub|hoagie|hoagies|cheesesteak|cheesesteaks|philly|bagel|bagels|panini|po-boy|po boy|poboy)\b", 5 ),
    ( r"\b(italian|trattoria|ristorante|pasta|osteria|cucina)\b", 7 ),
    ( r"\b(mediterranean|greek|gyro|gyros|kebab|kabob|kabab|shawarma|falafel|hummus|lebanese|turkish|persian|afghan|halal grill|middle eastern|souvlaki)\b", 21 ),
    ( r"\b(cajun|creole|soul food|southern|gumbo|po'?boys?|crawfish|biscuit|biscuits|catfish|chitlins|hot chicken)\b", 22 ),
    ( r"\b(cuban|caribbean|jamaican|jerk|puerto rican|dominican|latin|latino|peruvian|pollo a la brasa|salvadoran|colombian|venezuelan|arepa|arepas|empanada|empanadas|brazilian|churrascaria|honduran|guatemalan)\b", 18 ),
    ( r"\b(diner|pancake|pancakes|waffle|waffles|breakfast|brunch|ihop|waffle house|griddle)\b", 10 ),
    ( r"\b(vegan|vegetarian|veggie|salad|salads|juice|smoothie|smoothies|nutrition|acai|healthy)\b", 23 ),
    ( r"\b(french|bistro|brasserie|crepe|crepes|creperie|german|bavarian|schnitzel|polish|pierogi|irish pub|british|fish & chips|fish and chips|spanish|tapas|portuguese|russian|ukrainian)\b", 24 ),
    ( r"\b(filipino|asian|hawaiian|malaysian|indonesian|mongolian|cambodian|laotian|lao|burmese|boba|bubble tea|teriyaki grill|wok n roll)\b", 16 ),
    ( r"\b(mcdonald'?s|burger king|wendy'?s|taco bell|subway|sonic|arby'?s|jack in the box|hardee'?s|carl'?s jr|whataburger|dairy queen|checkers|rally'?s|white castle|drive-in|drive in|fast food)\b", 4 ),
    ( r"\b(grill|grille|american|tavern|pub|saloon|sports bar|bar & grill|bar and grill|roadhouse|alehouse|brewery|brewpub|gastropub|taphouse|lodge|supper club)\b", 1 ),
]
NAME_RULES = [ ( re.compile( p, re.I ), g ) for p, g in NAME_RULES ]


def group_from_name( name ):
    for rx, g in NAME_RULES:
        if rx.search( name or "" ):
            return g
    return 0
