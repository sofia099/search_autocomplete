# Text Search, Fuzzy Search, Semantic Search ...oh my!
Now with autocomplete suggestions!!!
<img width="1101" alt="Screenshot 2024-01-17 at 3 15 29 PM" src="https://github.com/sofia099/search_autocomplete/assets/59860423/64d64c1f-11d7-4dc7-9582-4a17fa4b272d">

Build your own text-based search engine with real-time smart autocomplete suggestions! The smart autocomplete takes into account spelling mistakes, word variations, and more! Search on precise text, keywords, and semantics of your own data - all powered by Rockset. This project implements the following standard text search concepts:
- Wilcard Techniques
- Tokenization
- Term Frequency (TF) with weights
- Ngrams
- Levenshtein Distance
- Vector Search

Check out [these slides](https://docs.google.com/presentation/d/11Cgn4iCBeleePXs7vykQ9EhbtxbAsqY2ryhtu_Oyowc/edit?usp=sharing) for more information on these concepts.

To build the autocomplete & text search on titles & keywords, you will need an account with Rockset. To build the semantic search (optional), you will need an account on both OpenAI and Rockset to get an API key for both platforms. Thankfully, API keys are available on the free versions of both platforms. To create an account on OpenAI go [here](https://platform.openai.com/signup?) and to create an account on Rockset go [here](https://rockset.com/create/).

## Step 1: Setup Collection in Rockset
Rockset already has a public dataset of book titles, descriptions, _and embeddings_! Follow the steps below to set-up this collection correctly:
  1. In the Rockset Console, go to the "Collections" tab and then select "Create a Collection"
  2. Scroll down and select "Public Datasets"
  3. Click the "Book Embeddings Dataset" then "Start"
  4. Once the preview has loaded, click "Next"
  5. There is a default ingest transformation, but we'll need to make a few additions for our text search use case. The [ingest transformation](https://docs.rockset.com/documentation/docs/ingest-transformation) is a powerful tool available in Rockset. It allows you to execute a SQL query on all incoming data _before_ it is stored in Rockset. For this project, we'll need to **tokenize** and create **ngrams** on the text we plan to search. Use the ingest transformation below:

  ```
  SELECT
  TOKENIZE(title, 'en_US') AS title_tokens, -- tokenizing the title
  NGRAMS(LOWER(title), 3) AS title_ngrams, -- creating ngrams of the title
  TOKENIZE(description, 'en_US') AS description_tokens, -- tokenizing the description
  title,
  series,
  author,
  TRY_CAST(rating as float) as rating,
  description,
  language,
  TRY_CAST (isbn as integer) as isbn,
  genres,
  characters,
  bookFormat as book_format,
  edition,
  TRY_Cast(pages as int) as page_count,
  publisher,
  publishDate as publish_date,
  firstPublishDate as first_publish_date,
  awards,
  TRY_CAST(numRatings as int) as num_ratings,
  ratingsByStars as ratings_by_stars,
  TRY_CAST(likedPercent as float) as liked_percent,
  setting,
  coverImg as cover_image,
  TRY_CAST(bbeScore as int) as bbe_score,
  TRY_Cast(bbeCotes as int) as bbe_votes,
  TRY_Cast(price as float) as price,
  VECTOR_ENFORCE(embedding, 1536, 'float') as book_embedding
FROM
  _input
where
  title is not NULL
  ```

  6. In the next page, type a workspace name and collection name. I used workspace=`Text-Search` and collection=`Books`.
  8. Final step is to click "Create" and wait for the data to ingest into your Rockset collection. This will only take a few minutes.<br /><br />

## Step 2 (only for Semantic Search): Build an IVF Index
In order to run semantic search on the embeddedings in the public dataset, we will need to build a special IVF Index. This can be done with the following query:

```
CREATE
	SIMILARITY INDEX text_search_book_embed
ON
	FIELD “Text-Search”.Books:book_embedding DIMENSION 1536 AS 'faiss::IVF256,Flat';
```

Run the query below to check the status of the index. Proceed when the status is `Ready`.

```
SELECT status
FROM _system.similarity_index
WHERE collection_name = 'Books'
```

For more information, check out [Rockset's Vector Search documentation](https://docs.rockset.com/documentation/docs/running-vector-search-with-rockset#rocksets-vector-search-indexing).

## Step 3: Create 3 Query Lambdas
Rockset's patented [Query Lambdas](https://docs.rockset.com/documentation/docs/query-lambdas) are named, parameterized SQL queries stored in Rockset that can be executed from a dedicated REST endpoint. In the Query Editor in Rockset, save the following SQL queries as a Query Lambdas. We will later call these in our webpage. Each Query Lambda below will require you to create a parameter `search_query` of type `string`.


Save the following query as a Query Lambda named `searchTitles` under the `Text-Search` workspace:
```
script {{{
export function levenshteinDistance(str1, str2) {
    // https://en.wikipedia.org/wiki/Levenshtein_distance#Iterative_with_two_matrix_rows
    const len1 = str1.length;
    const len2 = str2.length;

    let prevRow = Array.from({ length: len2 + 1 }, (_, i) => i);

    for (let i = 1; i <= len1; i++) {
        let currentRow = [i];
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            currentRow[j] = Math.min(
                prevRow[j] + 1,        // deletion
                currentRow[j - 1] + 1, // insertion
                prevRow[j - 1] + cost  // substitution
            );
        }
        prevRow = currentRow;
    }
    return prevRow[len2];
}
}}}

(
    SELECT
        title,
        'exact' as score,
        'exact' as distance,
        'exact' as hybrid_score,
        num_ratings
    FROM
        "Text-Search".Books
    WHERE
        LOWER(title) LIKE CONCAT(LOWER(:search_query), '%')
    ORDER BY
        num_ratings desc
    LIMIT
        10
)
UNION
(
    SELECT
        title,
        score() as score,
        _script.levenshteinDistance(title, :search_query) as distance,
        score() - 0.05 * _script.levenshteinDistance(title, :search_query) as hybrid_score,
        num_ratings
    FROM
        "Text-Search".Books
    WHERE
        search(
                CONTAINS(title_tokens, :search_query),
                BOOST(
                    0.5,
                    CONTAINS(
                        title_ngrams,
                        ARRAY_JOIN(NGRAMS(LOWER(:search_query), 3), ' ')
                    )
                )
            ) OPTION(match_all = false)
    ORDER BY
        hybrid_score desc, num_ratings desc
    LIMIT
        10
)
ORDER BY
    hybrid_score desc, num_ratings desc
LIMIT
    10
```

Save the following query as a Query Lambda named `searchKeywords` under the `Text-Search` workspace:
```
SELECT
    title,
    score() as score,
    num_ratings,
    description
FROM
    "Text-Search".Books
WHERE
    search(
        CONTAINS(title_tokens, :search_query),
        CONTAINS(description_tokens, :search_query)
    ) OPTION(match_all = false)
ORDER BY
    score desc,
    num_ratings desc
LIMIT
    10
```

Save the following query as a Query Lambda named `searchSemantic` under the `Text-Search` workspace:
```
SELECT
    title,
    APPROX_DOT_PRODUCT(
        JSON_PARSE(:search_query),
        book_embedding
    ) as similarity,
    num_ratings,
    description
FROM
    "Text-Search".Books HINT(access_path=index_similarity_search)
ORDER BY
    similarity DESC
LIMIT
    10
```

## Step 4: Create an API Key & Grab your Region
Create an API key in the [API Keys tab of the Rockset Console](https://console.rockset.com/apikeys). The region can be found in the dropdown menu at the top of the page. For more information, refer to [Rockset's API Reference](https://docs.rockset.com/documentation/reference/rest-api).<br /><br />

## Step 5: Update `search.html`
Before running the .html file, check the following lines & update as needed:
- line 89: `center: [37.7749, -122.4194]`<br />
  These are coordinates to San Francisco. Update if using another location dataset
- line 281: `const apiKey = "YOUR_ROCKSET_API_KEY";`<br />
  Update with your Rockset API Key from Step 4.
- line 282: `const apiServer = "YOUR_ROCKSET_REGION_URL"`<br />
  Update with your Rockset Region URL (ex: "https://api.usw2a1.rockset.com")
- line 283: `const qlWorkspace = 'airbnb'`<br />
  If you saved the Query Lambda from Step 3 in a different workspace, update here.
- line 284: `const qlName = 'airbnbSearch'`<br />
  If you saved the Query Lambda from Step 3 under a different name, update here.
<br /><br />

## Step 6: Run the .html file and start searching!
Now you're ready to search!
