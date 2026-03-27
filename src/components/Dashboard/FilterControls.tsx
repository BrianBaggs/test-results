import { SearchIcon, FilterIcon, ChevronDownIcon, ChevronUpIcon, XCircleIcon } from 'lucide-react';
interface FilterControlsProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  statusFilter: string;
  setStatusFilter: (status: string) => void;
  suiteFilter: string;
  setSuiteFilter: (suite: string) => void;
  classNameFilter: string;
  setClassNameFilter: (className: string) => void;
  showFilters: boolean;
  setShowFilters: (show: boolean) => void;
  suites: string[];
  classNames: string[];
  resetFilters: () => void;
  statusOptions?: Array<{ value: string; label: string }>;
}
export const FilterControls = ({
  searchTerm,
  setSearchTerm,
  statusFilter,
  setStatusFilter,
  suiteFilter,
  setSuiteFilter,
  classNameFilter,
  setClassNameFilter,
  showFilters,
  setShowFilters,
  suites,
  classNames,
  resetFilters,
  statusOptions
}: FilterControlsProps) => {
  const hasActiveFilters = statusFilter !== 'all' || suiteFilter !== 'all' || classNameFilter !== 'all' || searchTerm !== '';
  return <>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
        <div className="flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-4">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <label htmlFor="search-tests" className="sr-only">Search tests</label>
            <input id="search-tests" name="searchTests" type="text" placeholder="Search tests..." className="pl-10 pr-4 py-2 border border-gray-300 rounded-md w-full md:w-64" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <div className="flex space-x-2">
            <button className="flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors" onClick={() => setShowFilters(!showFilters)}>
              <FilterIcon className="w-5 h-5 mr-2" />
              Filters
              {showFilters ? <ChevronUpIcon className="w-5 h-5 ml-2" /> : <ChevronDownIcon className="w-5 h-5 ml-2" />}
            </button>
            {hasActiveFilters && <button onClick={resetFilters} className="flex items-center px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors">
                <XCircleIcon className="w-5 h-5 mr-2" />
                Clear Filters
              </button>}
          </div>
        </div>
      </div>
      {showFilters && <div className="mb-6 p-4 bg-gray-50 rounded-md">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label htmlFor="filter-status" className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select id="filter-status" name="filterStatus" className="w-full border border-gray-300 rounded-md px-3 py-2" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                {statusOptions ? (
                  statusOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="all">All Status</option>
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                    <option value="skipped">Skipped</option>
                  </>
                )}
              </select>
            </div>
            <div>
              <label htmlFor="filter-suite" className="block text-sm font-medium text-gray-700 mb-1">
                Test Suite
              </label>
              <select id="filter-suite" name="filterSuite" className="w-full border border-gray-300 rounded-md px-3 py-2" value={suiteFilter} onChange={e => setSuiteFilter(e.target.value)}>
                {suites.map(suite => <option key={suite} value={suite}>
                    {suite === 'all' ? 'All Suites' : suite}
                  </option>)}
              </select>
            </div>
            <div>
              <label htmlFor="filter-classname" className="block text-sm font-medium text-gray-700 mb-1">
                Class Name
              </label>
              <select id="filter-classname" name="filterClassName" className="w-full border border-gray-300 rounded-md px-3 py-2" value={classNameFilter} onChange={e => setClassNameFilter(e.target.value)}>
                {classNames.map(className => <option key={className} value={className}>
                    {className === 'all' ? 'All Classes' : className}
                  </option>)}
              </select>
            </div>
          </div>
        </div>}
    </>;
};