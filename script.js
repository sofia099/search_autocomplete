document.addEventListener('DOMContentLoaded', function () {
    const rocksetApiKey = "YOUR_ROCKSET_API_KEY"; // UPDATE WITH YOUR ROCKSET API KEY
    const apiServer = "YOUR_ROCKSET_REGION_URL" // UPDATE WITH YOUR ROCKSET REGION URL (ex: "https://api.usw2a1.rockset.com")
    const qlWorkspace = 'Text-Search'; // UPDATE if not the same
    const qlName_titles = 'searchTitles'; // UPDATE if not the same
    const qlName_keywords = 'searchKeywords'; // UPDATE if not the same
    const qlName_semantic = 'searchSemantic'; // UPDATE if not the same
    const openaiApiKey = "YOUR_OPENAI_API_KEY"; // UPDATE WITH YOUR OPENAI API KEY (only for semantic search)

    async function queryRockset(type, searchQuery) {
        let qlName, parameters;

        if (type === 'title' || type === 'keywords') {
            qlName = type === 'title' ? qlName_titles : qlName_keywords;
            parameters = [{ name: 'search_query', type: 'string', value: searchQuery }];
        } else if (type === 'semantic') {
            const searchEmbedding = await embedWithOpenAI(searchQuery);
            qlName = qlName_semantic;
            parameters = [{ name: 'search_embedding', type: 'string', value: `[${searchEmbedding}]` }];
        }

        try {
            const response = await fetch(`${apiServer}/v1/orgs/self/ws/${qlWorkspace}/lambdas/${qlName}/tags/latest`, {
                method: 'POST',
                headers: {
                    'Authorization': `ApiKey ${rocksetApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    'parameters': parameters
                })
            });

            const data = await response.json();

            if (data.error_id) {
                handleApiError(data.message);
                return null;
            } else {
                return data;
            }

        } catch (error) {
            handleApiError(error.message);
            return null;
        }
    }

    async function embedWithOpenAI(searchQuery) {
        try {
            const response = await fetch('https://api.openai.com/v1/embeddings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${openaiApiKey}`,
                },
                body: JSON.stringify({
                    'input': searchQuery,
                    'model': 'text-embedding-ada-002',
                }),
            });

            const data = await response.json();
            return data.data[0].embedding;

        } catch (error) {
            handleApiError(error.message);
            return null;
        }
    }

    function handleApiError(errorMessage) {
        const errorBox = document.getElementById('error-box');
        errorBox.style.display = 'block';
        document.getElementById('error-text-box').value = errorMessage;
    }

    async function searchBooks(type) {
        const searchQuery = document.getElementById(`${type}-search-bar`).value;
        const data = await queryRockset(type, searchQuery);

        const resultsTable = document.getElementById('results-table');
        resultsTable.innerHTML = '';

        if (data && data.results.length > 0) {
            const tableHeaders = Object.keys(data.results[0]);
            const reversedTableHeaders = [...tableHeaders].reverse();

            resultsTable.innerHTML += `<tr>${reversedTableHeaders.map(header => `<th>${header}</th>`).join('')}</tr>`;

            data.results.forEach(record => {
                const row = `<tr>${reversedTableHeaders.map(header => `<td>${record[header]}</td>`).join('')}</tr>`;
                resultsTable.innerHTML += row;
            });
        } else {
            resultsTable.innerHTML = '<p>No results found :(</p>';
        }
    }

    async function getAutocomplete(type) {
        const searchQuery = document.getElementById(`${type}-search-bar`).value;

        if (searchQuery.trim() === '') {
            const autocompleteResults = document.getElementById('autocomplete-results');
            autocompleteResults.style.display = 'none';
            return;
        }

        const data = await queryRockset(type, searchQuery);
        const autocompleteResults = document.getElementById('autocomplete-results');

        if (data.error_id) {
            autocompleteResults.innerHTML = data.message;
        } else if (!data.results) {
            autocompleteResults.innerHTML = 'No results :(';
        } else {
            const resultList = document.createElement('ul');

            data.results.forEach(record => {
                const listItem = document.createElement('li');
                listItem.textContent = record.title;
                resultList.appendChild(listItem);
            });

            autocompleteResults.innerHTML = '';
            autocompleteResults.appendChild(resultList);
            autocompleteResults.style.display = 'block';
        }
    }

    function showTab(tabId) {
        const tabs = document.querySelectorAll('.tab-content');
        tabs.forEach(tab => {
            tab.classList.remove('active-tab');
        });

        const selectedTab = document.getElementById(tabId);
        selectedTab.classList.add('active-tab');
    }

    document.body.addEventListener('click', function (event) {
        const autocompleteResults = document.getElementById('autocomplete-results');
        if (!autocompleteResults.contains(event.target)) {
            autocompleteResults.style.display = 'none';
        }
    });

    const tabButtons = document.getElementById('tab-buttons');
    tabButtons.addEventListener('click', function (event) {
        if (event.target.classList.contains('tab-button')) {
            const tabId = event.target.getAttribute('data-tab');
            showTab(tabId);
        }
    });

    document.body.addEventListener('click', function (event) {
        if (event.target.classList.contains('search-button')) {
            const type = event.target.getAttribute('data-type');
            searchBooks(type);
        }
    });

    document.body.addEventListener('input', function (event) {
        if (event.target.classList.contains('search-bar')) {
            const type = event.target.getAttribute('data-type');
            getAutocomplete(type);
        }
    });
});
