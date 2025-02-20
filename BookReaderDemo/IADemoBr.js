/* global BookReader, BookReaderJSIAinit */
import { extraVolOptions, custvolumesManifest } from './ia-multiple-volumes-manifest.js';

/**
 * This is how Internet Archive loads bookreader
 */
const urlParams = new URLSearchParams(window.location.search);

const ocaid = urlParams.get('ocaid');
const openFullImmersionTheater = urlParams.get('view') === 'theater';
const ui = urlParams.get('ui');
const autoflip = urlParams.get('autoflip');
const searchTerm = urlParams.get('q');

const iaBookReader = document.querySelector('ia-bookreader');

if (openFullImmersionTheater) {
  $(document.body).addClass('BRfullscreenActive');
  iaBookReader.fullscreen = openFullImmersionTheater;
}

const modal = document.querySelector('modal-manager');
iaBookReader.modal = modal;

// Override options coming from IA
BookReader.optionOverrides.imagesBaseURL = '/BookReader/images/';

const initializeBookReader = (brManifest) => {
  console.log('initializeBookReader', brManifest);
  const br = new BookReader();

  const customAutoflipParams = {
    autoflip: !!autoflip,
    flipSpeed: urlParams.flipSpeed || 2000,
    flipDelay: urlParams.flipDelay || 5000
  };

  const options = {
    el: '#BookReader',
    /* Url plugin - IA uses History mode for URL */
    // commenting these out as demo uses hash mode
    // keeping them here for reference
    // urlHistoryBasePath: `/details/{$ocaid}/`,
    // resumeCookiePath: `/details/{$ocaid}/`,
    // urlMode: 'history',
    // Only reflect these params onto the URL
    // urlTrackedParams: ['page', 'search', 'mode'],
    /* End url plugin */
    enableBookTitleLink: false,
    bookUrlText: null,
    startFullscreen: openFullImmersionTheater,
    initialSearchTerm: searchTerm ? searchTerm : '',
    // leaving this option commented out bc we change given user agent on archive.org
    // onePage: { autofit: <?=json_encode($this->ios ? 'width' : 'auto')?> },
    showToolbar: false,
    /* Multiple volumes */
    // To show multiple volumes:
    enableMultipleBooks: false, // turn this on
    multipleBooksList: [], // populate this  // TODO: get sample blob and tie into demo
    /* End multiple volumes */
    enableBookmarks: true, // turn this on
    enableFSLogoShortcut: true,
  };

  // we want to show item as embedded when ?ui=embed is in URI
  if (ui === 'embed') {
    options.mode = 1;
    options.ui = 'embed';
  }

  // we expect this at the global level
  BookReaderJSIAinit(brManifest.data, options);

  if (customAutoflipParams.autoflip) {
    br.autoToggle(customAutoflipParams);
  }
};

window.initializeBookReader = initializeBookReader;

const multiVolume = document.querySelector('#multi-volume');
multiVolume.addEventListener('click', () => {
  // remove everything
  $('#BookReader').empty();
  delete window.br;
  // and re-mount with a new book
  BookReaderJSIAinit(custvolumesManifest, extraVolOptions);
});


const fetchBookManifestAndInitializeBookreader = async (iaMetadata) => {
  document.querySelector('input[name="itemMD"]').checked = true;
  iaBookReader.item = iaMetadata;

  const {
    metadata: {
      identifier
    },
  } = iaMetadata;

  const locator = `https://archive.org/bookreader/BookReaderJSLocate.php?format=json&subPrefix=&id=${identifier}`;
  // Todo: move from `locator` to create `iaManifestUrl` url from `iaMetadata`
  // so we can support multiple volumes
  // const iaManifestUrl = `https://${server}/BookReader/BookReaderJSIA.php?format=jsonp&itemPath=${dir}&id=${identifier}`;

  const manifest = await fetch(locator)
    .then(response => response.json());
  document.querySelector('input[name="bookManifest"]').checked = true;

  initializeBookReader(manifest);
};

// Temp; Circumvent bug in BookReaderJSIA code
window.Sentry = null;
window.logError = function(e) {
  console.error(e);
};
fetch(`https://archive.org/metadata/${ocaid}`)
  .then(response => response.json())
  .then(iaMetadata => fetchBookManifestAndInitializeBookreader(iaMetadata));
