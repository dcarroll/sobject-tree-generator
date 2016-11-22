var dataRecords,
    rootType,
    compositeObj;
    index = 0,
    metaDatas = {},
    outputObjects = {},
    args = {},
    dataObjects = {},
    mapOfRefObjects = {};

var path = require("path");
var fs = require("fs");

// Sample query
var sql1 = `
Select Id, Name, Industry, (Select FirstName, LastName, Email, Phone From Contacts) From Account
`;
var sql2 = `
Select Id, Name, Industry, (Select Status, Origin, Subject From Cases), (Select FirstName, LastName, Email, Phone From Contacts) From Account
`;

/*
  app.js -soql:<soql, or file> -f or -p -prefix:<some file prefix>
*/
var main = function() {
  mapifyArgs();
  if (args.soql) {
    if (args.soql.toLowerCase().trim().indexOf("select") !== 0) {
      dataRecords = require(`${path.resolve(args.soql)}`);
      if (dataRecords.soql) {
        // This is a not a data file, but rather a stored query
        dataRecords = runQuery(dataRecords.soql);
      }
    } else {
      dataRecords = runQuery(args.soql);
    }

    processObjectList(dataRecords);

  } else {
    console.log("Run the command like \n" + 
      "node app.js in:<input data file> format:[plan, files]\n" +
      " or " +
      "node app.js soql:<SOQL> format:[plan, files]");
  }
}

var mapifyArgs = function() {
  process.argv.forEach(function(arg) {
    if (arg.indexOf(":") > 0) {
      args[arg.split(":")[0]] = arg.split(":")[1];
    } else if (arg.indexOf("-") === 0) {
      args[arg.substring(1)] = arg;
    }
  });
}

var runCommand = function(command) {
  try {
    var cp = require('child_process');
    var stdout = cp.execSync(command).toString();
    return JSON.parse(stdout);
  } catch(err) {
    console.error(err.message);
    process.exit(1);
  } 
}
var runQuery = function(soql) {
  return runCommand('force query "' + soql + '" --format:json');
}

var processObjectList = function(recordList) {
  getObjectsIncludedInData(recordList);
  var cobj = doRefReplace(processRecordList(recordList).records);
  if (typeof args.f === "undefined") {
    splitIntoFiles(cobj);
  } else {
    var fName = Object.keys(dataObjects).join("_") + ".json";
    if (args.prefix) {
      fName = args.prefix + fName;
    }
    writeFile(fName, cobj);
  }
}

/*var processObjectListx = function(rootObj, referenceId, parentReference) {
  if (Array.isArray(rootObj)) {
    rootType = rootObj[0].attributes.type;
    getMetadata(rootType)
    console.log("Processing a " + rootType + " query.\n");
    rootObj.forEach(function(obj) {
      outputObject = { attributes:
                        { 
                          type: rootType, 
                          referenceId: referenceId || obj.Id 
                        }
                      };
      outputObjects[obj.Id] = outputObject;
      for (var key in obj) {
        if (key === "attributes") {
          // Got some attributes, we want to do something with this.
          // it will have a type and url in it.
        } else {
          if (isQueryResult(rootType, key) === true) {
            // This should be child records. We could go re-entrant here
            var qr = obj[key];
            var parentReferenceField = getRelationshipFieldName(qr.records[0].attributes.type, rootType);

            processObjectList(obj[key].records, obj.Id, { name: parentReferenceField, key: obj.Id});
          } else {
            // Regular field value
            if (key !== "Id") {
              outputObjects[obj.Id][key] = obj[key];
            }
          }
        }
        if (parentReference) {
          outputObjects[obj.Id][parentReference.name] = "@" + parentReference.key;
        }
      }
    })
  }
}*/

var processRecordList = function(recordList, parentRef) {
  // cObj will hold the transformed sobject tree
  var cObj = { records: [] };

  // visit each record in the list
  recordList.forEach(function(queriedRecord) {

    // objRefId is incremented every time we visit another record
    var objRefId = "ref" + index++;

    // add the attributes for this record, setting the type and reference
    var treeRecord = { attributes: {
      type: queriedRecord.attributes.type,
      referenceId: objRefId 
    }};
    
    // Store the reference in a map with the record id
    addObjectRef(queriedRecord, objRefId);

    // Visit each field in the queried record
    for (var key in queriedRecord) {
      var queriedField = queriedRecord[key];

      // We skip attributes and id
      if (key !== "attributes" && key !== "Id") {

        // If this is a queryresult (children) then process the records
        if (isQueryResult(queriedRecord.attributes.type, key)) {
          // some query results are empty, so we don't need to do any more with it
          if (queriedField !== null) {
            treeRecord[key] = processRecordList(queriedField.records, 
            { 
              id: "@" + objRefId, 
              fieldName: getRelationshipFieldName(queriedField.records[0].attributes.type, queriedRecord.attributes.type)
            });
          }
        } else {
          // This should be a key/value pair and can be empty too
          if (queriedRecord[key] !== null) {
            if (isEmail(queriedRecord.attributes.type, key)) {
              // Email should be validated, not sure how invalid emails exist but they do
              if (validateEmail(queriedRecord[key])) {
                //  Add the field to the treeRecord
                treeRecord[key] = queriedRecord[key];
              }
            } else {
              // Not email, so need to see if this is a relationship field
              if (isRelationship(queriedRecord.attributes.type, key)) {
                // Related to what??
                var relTo = getRelatedTo(queriedRecord.attributes.type, key);
                if (typeof args.f === "undefined") {
                  // Is this a relationship to an object in the data???
                  if (dataObjects[relTo]) {
                    // add ref to replace the value
                    var id = queriedRecord[key];
                    var relatedObject = mapOfRefObjects[relTo];
                    if (typeof relatedObject !== "undefined") {
                      var ref = mapOfRefObjects[relTo][queriedRecord[key]];
                      if (typeof ref === "undefined") {
                        // Need to leave this intact, because we may not have processed
                        // this parent fully, we will go back through the sObject tree 
                        // later and replace the id with a reference.
                        treeRecord[key] = id;
                      } else {
                        treeRecord[key] = "@" + ref;
                      }
                    } else if (typeof relatedObject === "undefined" ) {
                      // Again, this will just be the id for now and replaced with a ref later.
                      treeRecord[key] = id;
                    } 
                  }
                } 
              } else {
                // Not a relationship field, simple key/value insertion
                treeRecord[key] = queriedRecord[key];
              }
            }
          }
        }
      } else if (key === "attributes") {
        // If this is an attributes section then we need to add an object reference
        addObjectRef(queriedRecord, objRefId);
      }
    }
    if (parentRef && typeof args.f === "undefined") {
      if (!treeRecord[parentRef.fieldName]) {
        treeRecord[parentRef.fieldName] = parentRef.id;
      }
    }
    // Add this record to the result set
    cObj.records.push(treeRecord);
  });
  return cObj;
}

/*************************************************************
    These methods use the Force CLI to query data or metadata
    The metadata is cached after the first time it is queried
**************************************************************/

var getMetadata = function(objectName) {
	if (!metaDatas[objectName]) {
    var md = runCommand('force describe -t sobject -n ' + objectName + ' -j');
 		metaDatas[objectName] = md;
	} 
	return metaDatas[objectName];
}

var isQueryResult = function(objectName, fieldName) {
	var result = false;
	var md = getMetadata(objectName);
	return md.childRelationships.some(function(cr) {
		if (cr.relationshipName === fieldName) {
			result = true;
			return result;
		}
	});
	return result;
}

var isSpecificType = function(objectName, fieldName, fieldType) {
  var result = false;
  var md = getMetadata(objectName);
  for (var i=0;i<md.fields.length;i++) {
    fld = md.fields[i];
    if (fld.name.toLowerCase() === fieldName.toLowerCase()) {
      if (fld.type.toLowerCase() === fieldType.toLowerCase()) {
        result = true;
        break;
      }
    }
  };
  return result;
}

var getRelationshipFieldName = function(objectName, parentName) {
  var md = getMetadata(objectName);
  var result;
  md.fields.some(function(field) {
    if (field.type === "reference") {
      for (var i=0;i<field.referenceTo.length;i++) {
        if (field.referenceTo[i] === parentName) {
          result = field.name;
          return true;
        }
      }
    }
  });
  return result;
}

var isRelationship = function(objectName, fieldName) {
  return isSpecificType(objectName, fieldName, "reference");
}

var isEmail = function(objectName, fieldName) {
  return isSpecificType(objectName, fieldName, "email");
}

var getRelatedTo = function(objectName, fieldName) {
  var md = getMetadata(objectName);
  var result;
  md.fields.some(function(field) {
    if (field.name === fieldName) {
      for (var i=0;i<field.referenceTo.length;i++) {
        result = field.referenceTo[i];
        return true;
      }
    }
  });
  return result;
}

var getObjectsIncludedInData = function(recordList) {
  // Scan the data set, we only need to scan the top level
  dataObjects[recordList[0].attributes.type] = { 
    order: 0, 
    type: recordList[0].attributes.type,
    saveRefs: true,
    resolveRefs: false
  };
  for (var i=0;i<recordList.length;i++) {
    var record = recordList[i];
    for (var key in record) {
      if (record[key] !== null) {
        if (record[key].records) {
          // Found a related object, add to map
          if (!dataObjects[key]) {
            dataObjects[record[key].records[0].attributes.type] = { 
              order: 1, 
              type: record[key].records[0].attributes.type,
              saveRefs: false,
              resolveRefs: true
            };
          }
        }
      }
    }
  }
}

var addObjectRef = function(obj, refId) {
  var refObj = {};
  var path = require("path");
  refObj["id"] = path.basename(obj.attributes.url);
  refObj["ref"] = refId;
  if (typeof mapOfRefObjects[obj.attributes.type] === "undefined") {
    mapOfRefObjects[obj.attributes.type] = {}
  }
  mapOfRefObjects[obj.attributes.type][refObj.id] = refObj.ref;
}

var splitIntoFiles = function(cObj) {
  // Walk the final data set and split out into files.
  // The main queried object is the parent, and has a different
  // saveRefs and resolveRefs values.  All the references have 
  // been created at this point.
  var objects = {};
  var dataPlan = [];
  var masterType;

  cObj.records.forEach(function(masterRecord) {
    masterType = masterRecord.attributes.type;
    if (typeof objects[masterType] === "undefined") {
      objects[masterType] = { records: [] };
    }
    for (var key in masterRecord) {
      if (masterRecord[key].records) {
        // This is a set of child records, need to add to the map of arrays
        var children = masterRecord[key];
        var childType = children.records[0].attributes.type;
        if (typeof objects[childType] === "undefined") {
          objects[childType] = { records: [] };
        }
        children.records.forEach(function(child) {
          objects[childType].records.push(child);
        });
        delete masterRecord[key];
      } 
    }
    objects[masterType].records.push(masterRecord);
  });

  var objectsOrdered =  Object.keys(dataObjects).sort(function(a,b){
    return dataObjects[a].order - dataObjects[b].order 
  });
  
  objectsOrdered.forEach(function(key) {
    dataPlan.push(addDataPlanPart(key, dataObjects[key].saveRefs, dataObjects[key].resolveRefs, key + "s.json", objects[key]));
  });
  if (args.prefix) {  
    writeFile(args.prefix + "data-plan.json", dataPlan);
  } else {
    writeFile("data-plan.json", dataPlan);
  }
}

var addDataPlanPart = function(type, saveRefs, resolveRefs, fileName, sObject) {
  if (args.prefix) {
    fileName = args.prefix + fileName;
  }
  var dataPlanPart = { sobject: type,
                       saveRefs: saveRefs,
                       resolveRefs: resolveRefs,
                       files: [ fileName ]
                     };
  writeFile(fileName, sObject);
  return dataPlanPart;
}

/*
  This method is used as a second pass to establish references that couldn't be determined
  in the initial pass done by processRecordList. It looks for relationship fileds that 
  contain an id
*/
var doRefReplace = function(cObj) {
  cObj.forEach(function(record) {
    for (var field in record) {
      if (record[field].records) {
        // These are children
        doRefReplace(record[field].records);
      } else {
        var objType = record.attributes.type;
        
        if (isRelationship(objType, field)) {
          var id = record[field].toString(),
              refTo = getRelatedTo(objType, field),
              ref = mapOfRefObjects[refTo][id]
          // Setup dependency ordering for later output
          if(dataObjects[objType].order <= dataObjects[refTo].order) {
            dataObjects[objType].order = dataObjects[refTo].order + 1;
            dataObjects[refTo].saveRefs = true;
            dataObjects[objType].resolveRefs = true;
          }

          // Make sure this reference field does not already hava a reference
          if (id.indexOf("@") !== 0) {
            record[field] = "@" + ref;
          }
        }
      }
    }
  });
  return { records: cObj };
}

var validateEmail = function(email) {
    var re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email);
}

var writeFile = function(filename, jsonObject) {
  var fs = require('fs');
    fs.writeFile(filename, JSON.stringify(jsonObject, null, 2), "utf-8", function(err) {
      if (err) {
        return console.log(err);
      }
    });  
}

main();



