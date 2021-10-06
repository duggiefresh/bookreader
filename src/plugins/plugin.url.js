/* global BookReader */
/**
 * Plugin for URL management in BookReader
 * Note read more about the url "fragment" here:
 * https://openlibrary.org/dev/docs/bookurls
 */

jQuery.extend(BookReader.defaultOptions, {
  enableUrlPlugin: true,
  bookId: '',
  /** @type {string} Defaults can be a urlFragment string */
  defaults: null,
  updateWindowTitle: false,

  /** @type {'history' | 'hash'} */
  urlMode: 'hash',

  /**
   * When using 'history' mode, this part of the URL is kept constant
   * @example /details/plato/
   */
  urlHistoryBasePath: '/',

  /** Only these params will be reflected onto the URL */
  urlTrackedParams: ['page', 'search', 'mode', 'region', 'highlight'],

  /** If true, don't update the URL when `page == n0 (eg "/page/n0")` */
  urlTrackIndex0: false,
});

/** @override */
BookReader.prototype.setup = (function(super_) {
  return function(options) {
    super_.call(this, options);

    this.bookId = options.bookId;
    this.defaults = options.defaults;

    this.locationPollId = null;
    this.oldLocationHash = null;
    this.oldUserHash = null;
  };
})(BookReader.prototype.setup);

/** @override */
BookReader.prototype.init = (function(super_) {
  return function() {

    if (this.options.enableUrlPlugin) {
      this.bind(BookReader.eventNames.PostInit, () => {
        const { updateWindowTitle, urlMode } = this.options;
        if (updateWindowTitle) {
          document.title = this.shortTitle(50);
        }
        if (urlMode === 'hash') {
          this.urlStartLocationPolling();
        }
      });

      this.bind(BookReader.eventNames.fragmentChange,
        this.urlUpdateFragment.bind(this)
      );
    }
    super_.call(this);
  };
})(BookReader.prototype.init);

/**
 * Returns a shortened version of the title with the maximum number of characters
 * @param {number} maximumCharacters
 * @return {string}
 */
BookReader.prototype.shortTitle = function(maximumCharacters) {
  if (this.bookTitle.length < maximumCharacters) {
    return this.bookTitle;
  }

  const title = `${this.bookTitle.substr(0, maximumCharacters - 3)}...`;
  return title;
};

/**
 * Starts polling of window.location to see hash fragment changes
 */
BookReader.prototype.urlStartLocationPolling = function() {
  this.oldLocationHash = this.urlReadFragment();

  if (this.locationPollId) {
    clearInterval(this.locationPollID);
    this.locationPollId = null;
  }

  const updateHash = () => {
    const newFragment = this.urlReadFragment();
    const hasFragmentChange = (newFragment != this.oldLocationHash) && (newFragment != this.oldUserHash);

    if (!hasFragmentChange) { return; }

    const params = this.paramsFromFragment(newFragment);

    const updateParams = () => this.updateFromParams(params);

    this.trigger(BookReader.eventNames.stop);
    if (this.animating) {
      // Queue change if animating
      if (this.autoStop) this.autoStop();
      this.animationFinishedCallback = updateParams;
    } else {
      // update immediately
      updateParams();
    }
    this.oldUserHash = newFragment;
  };

  this.locationPollId = setInterval(updateHash, 500);
};

/**
 * Update URL from the current parameters.
 * Call this instead of manually using window.location.replace
 */
BookReader.prototype.urlUpdateFragment = function() {
  const allParams = this.paramsFromCurrent();
  const { urlMode, urlTrackIndex0, urlTrackedParams } = this.options;

  if (!urlTrackIndex0
      && (typeof(allParams.index) !== 'undefined')
      && allParams.index === 0) {
    delete allParams.index;
    delete allParams.page;
  }

  const params = urlTrackedParams.reduce((validParams, paramName) => {
    if (paramName in allParams) {
      validParams[paramName] = allParams[paramName];
    }
    return validParams;
  }, {});

  const newFragment = this.fragmentFromParams(params, urlMode);
  const currFragment = this.urlReadFragment();
  const currQueryString = this.getLocationSearch();
  const newQueryString = this.queryStringFromParams(params, currQueryString, urlMode);
  if (currFragment === newFragment && currQueryString === newQueryString) {
    return;
  }

  if (urlMode === 'history') {
    console.log('urlMode history: ', history);
    if (window.history && window.history.replaceState) {
      const baseWithoutSlash = this.options.urlHistoryBasePath.replace(/\/+$/, '');
      const newFragmentWithSlash = newFragment === '' ? '' : `/${newFragment}`;

      const newUrlPath = `${baseWithoutSlash}${newFragmentWithSlash}${newQueryString}`;
      window.history.replaceState({}, null, newUrlPath);
      this.oldLocationHash = newFragment + newQueryString;
    }
  } else {
    console.log('urlMode hash: ');
    const newQueryStringSearch = this.urlParamsFiltersOnlySearch(this.readQueryString());
    window.location.replace('#' + newFragment + newQueryStringSearch);
    this.oldLocationHash = newFragment + newQueryStringSearch;
  }

  console.log('thisOldLocationHash: ', this.oldLocationHash);
};

/**
 * @private
 * Filtering query parameters to select only book search param (?q=foo)
   This needs to be updated/URL system modified if future query params are to be added
 * @param {string} url
 * @return {string}
 * */
BookReader.prototype.urlParamsFiltersOnlySearch = function(url) {
  const params = new URLSearchParams(url);
  return params.has('q') ? `?${new URLSearchParams({ q: params.get('q') })}` : '';
};


/**
 * Will read either the hash or URL and return the bookreader fragment
 * @return {string}
 */
BookReader.prototype.urlReadFragment = function() {
  const { urlMode, urlHistoryBasePath } = this.options;
  if (urlMode === 'history') {
    return window.location.pathname.substr(urlHistoryBasePath.length);
  } else {
    return window.location.hash.substr(1);
  }
};

/**
 * Will read the hash return the bookreader fragment
 * @return {string}
 */
BookReader.prototype.urlReadHashFragment = function() {
  return window.location.hash.substr(1);
};


export class UrlPlugin {

  constructor(options = {}) {
    console.log('url plugin constructor');

    this.bookReaderOptions = options;

    this.urlSchema = [
      { name: 'page', position: 'path', default: 'n0' },
      { name: 'mode', position: 'path' },
      { name: 'search', position: 'path', deprecated_for: 'q' },
      { name: 'q', position: 'query_param' },
      { name: 'sort', position: 'query_param' },
      { name: 'view', position: 'query_param' },
      { name: 'admin', position: 'query_param' },
    ];

    this.urlState = {};
    this.urlMode = 'hash';
    this.combinedUrlStrPath = '';
    this.urlHistoryBasePath = '/';

    this.pullFromAddressBar();
  }

  /**
   * Parse JSON object URL state to string format
   * @param {object} state
   */
  urlStateToUrlString() {
    // this.setUrlParam('q', 'foo');
    console.log('url state to string: ', this.urlState);
    let strPathParams = '';
    let hasAppendQueryParams = false;
    const searchParams = new URLSearchParams();

    Object.keys(this.urlState).map(key => {
      const schema = this.urlSchema.filter(schema => schema.name === key)[0];
      if (schema) {
        if (schema.position == 'path') {
          strPathParams = `${strPathParams}/${key}/${this.urlState[key]}`;
        } else if (schema.position == 'query_param') {
          searchParams.append(key, this.urlState[key]);
          hasAppendQueryParams = true;
        } else {
          console.log('could be something else');
        }
      } else {
        console.log('not a valid url schema');
      }
    });

    this.combinedUrlStrPath = hasAppendQueryParams ? `${strPathParams}?${searchParams.toString()}` : strPathParams;
    console.log('urlStateToUrlString combinedURlStrPath: ', this.combinedUrlStrPath);
  }

  // urlStringToUrlState('/page/n7') == {'page': 'n7'}
  // urlStringToUrlState('/page/n7?q=hello') == {'page': 'n7', 'q': 'hello'}
  // urlStringToUrlState('/path/n7?admin=1') == {'page': 'n7', 'admin': '1'}
  /**
   * Parse string URL add it in the current urlState
   * @param {string} str
   */
  urlStringToUrlState(str) {
    console.log('url string to url state: ', str);

    // this is working for url paths only
    const urlStrSplitSlash = str.split('/');
    this.urlSchema.map(schema => {
      const pKey = urlStrSplitSlash.filter(item => item === schema.name);
      if (pKey.length === 1) {
        const indexOf = urlStrSplitSlash.indexOf(schema.name) + 1;
        this.urlState[pKey] = urlStrSplitSlash[indexOf];
      }
    });
    // end [working] url paths parsing

    // TODO:
    // - add a way to parse string with query string
    // - write test

    console.log('new current urlState: ', this.urlState);
    this.urlStateToUrlString();
  }

  /**
   * Add or update key-value to the urlState
   * @param {string} key
   * @param {string} val
   */
  setUrlParam(key, value) {
    this.urlState[key] = value;
  }

  /**
   * Delete key-value to the urlState
   * @param {string} key
   */
  removeUrlParam(key) {
    delete this.urlState[key];
  }

  /**
   * Get key-value from the urlState
   * @param {string} key
   * @returns {string} value
   */
  getUrlParam(key) {
    return this.urlState[key];
  }

  pushToAddressBar() {
    // const newPath = this.urlStateToUrlString(this.urlState);
    // if (this.curPath == newPath) return;
    if (this.mode == 'history') {
      // window.history.replaceState(...)
      // window.location.hash = '';
    } else {
      // window.location.replace('#' + str);
    }
    // this.curPath = newPath;
    // this.br.trigger('fragmentChange');
  }

  /**
   * @param {string} hash
   * @param {string} fullUrl
   */
  pullFromAddressBar(hash = window.location.hash, fullUrl = window.location) {
    const urlFragment = this.urlReadFragment();
    console.log('urlReadFragment: ', this.urlReadFragment());
    if (this.urlMode === 'history') {
      console.log('mode history: ', fullUrl);
    // Also need to read hash url, and combine the states from the
    //   const mainUrlState = this.urlStringToUrlState(fullUrl.location);
    //   console.log('mainUrlState: ', mainUrlState);
    // combine the two objects
    // this.urlState = combine(...);
    } else {
      console.log('mode hash: ', hash.slice(1));
      this.urlStringToUrlState(urlFragment);
    }
  }

  // TODO: cant figure out a way to listen to hash changes yet
  listenForHashChanges() {
    console.log('listen for hash changes');
  }

  /**
   * Will read either the hash or URL and return the bookreader fragment
   * @return {string}
   */
  urlReadFragment () {
    if (this.urlMode === 'history') {
      return window.location.pathname.substr(this.urlHistoryBasePath.length);
    } else {
      return window.location.hash.substr(1);
    }
  }

  /**
   * Will read the hash return the bookreader fragment
   * @return {string}
   */
  urlReadHashFragment () {
    return window.location.hash.substr(1);
  }

}

export class BookreaderUrlPlugin extends BookReader {

  init() {
    super.init();

    console.log('BookreaderUrlPlugin this.options', this.options);
    if (this.options.enableUrlPlugin) {
      this.urlPlugin = new UrlPlugin(this.options);
      this.bind(BookReader.eventNames.PostInit, () => {
        const { updateWindowTitle, urlMode } = this.options;
        if (updateWindowTitle) {
          document.title = this.shortTitle(50);
        }
        if (urlMode === 'hash') {
          this.urlPlugin.listenForHashChanges();
        }
      });
    }
  }

}

window.BookReader = BookreaderUrlPlugin;
export default BookreaderUrlPlugin;
