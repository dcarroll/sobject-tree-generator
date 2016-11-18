# sobject-tree-generator

This is proof of concept only

To try this out you need to have the Force CLI installed and be logged in to the org that you want to pull data from.

The app.js application can be invoked using

```
node app.js soql:"Select Id, Name, Industry, (Select Status, Origin, Subject From Cases), (Select FirstName, LastName, Email, Phone From Contacts) From Account" format:files
```

This will execute the query and transform the JSON query results into an SObject tree for use by the heroku force:data:import command of the SFDX CLI to import data into a scratch org.

There are currently two formats, "files" and "plan".  

The "files" format will create a true SObject tree structure for single file import using the -f flag of the force:data:import command.
The "plan" format will create a set of files, one for each SObject returned from the query and one for the data plan.

## Limitations
Right now, if you return more than two SObject (parent and children) all the children will be parented only to the parent. There are situations where a child can be the child of multiple parents, and only one releationship is established.
For instance the Case object can be the child of both Account and Contact at the same time.  The SOQL statement given in the sample above will related the Contacts correctly to the Account and the Case correctly to the Account but will not relate the Cases to the Contacts.

The "plan" format is not currently working.
