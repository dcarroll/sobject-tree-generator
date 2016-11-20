# sObject-tree-generator

This is proof of concept only

To try this out you need to have the Force CLI installed and be logged in to the org that you want to pull data from.
This is a command line POC.  The options and flags are:

* soql:<soql text> - This can be a valid SOQL string or the path/name to a file containing a SOQL string.
   * example -> soql:"Select Id, Name, Industry, (Select Id, FirstName, LastName From Contacts) From Account"
   * example -> soql:querys.json
* prefix:<string> - This is OPTIONAL and will prefix the output files with this string.
   * example -> prefix:"build4-"
* -f - use this to indicate that the sObject tree is defined as a single file instead of multiple files and a data plan file.

The app.js application can be invoked using

```
node app.js soql:"Select Id, Name, Industry, (Select Status, Origin, Subject From Cases), (Select FirstName, LastName, Email, Phone From Contacts) From Account" -f prefix:"testing-"
```
You can also use a query that is saved in a file

```
node app.js soql:querys.json prefix:"testing-"
```

To generate a single sObject tree:

```
node app.js soql:querys.json -f prefix:"testing-"
```

This will execute the query and transform the JSON query results into an SObject tree for use by the heroku force:data:import command of the SFDX CLI to import data into a scratch org.

There are currently two formats, "files" and "plan".  

## Limitations
Needs more testing!!!
