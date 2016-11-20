var dataObj,
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
      dataObj = require(`${path.resolve(args.soql)}`);
      if (dataObj.soql) {
        // This is a not a data file, but rather a stored query
        dataObj = runQuery(dataObj.soql);
      }
    } else {
      dataObj = runQuery(args.soql);
    }

    processObjectList(dataObj);

  } else {
    console.log("Run the command like \n" + 
      "node app.js in:<input data file> format:[plan, files]\n" +
      " or " +
      "node app.js soql:<SOQL> format:[plan, files]");
    return;
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

/*************************************************************
    These methods use the Force CLI to query data or metadata
    The metadata is cached after the first time it is queried
**************************************************************/
var runQuery = function(soql) {
  var cp = require('child_process');
  var cmd = 'force query "' + soql + '" --format:json'
  var stdout = cp.execSync(cmd).toString();
  return JSON.parse(stdout); 
}

var getMetadata = function(objectName) {
	if (!metaDatas[objectName]) {
		var cp = require('child_process');
		var cmd = 'force describe -t sobject -n ' + objectName + ' -j';

		var stdout = cp.execSync(cmd).toString();
  		var md = JSON.parse(stdout);
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

var isReference = function(objectName, fieldName) {
  return isSpecificType(objectName, fieldName, "reference");
}

var isEmail = function(objectName, fieldName) {
  return isSpecificType(objectName, fieldName, "email");
}

var getReferenceTo = function(objectName, fieldName) {
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

var processObjectList = function(rootObj) {
  getObjectsIncludedInData(rootObj);
  var cobj = doRefReplace(processObjectArray(rootObj).records);
  if (typeof args.f === "undefined") {
    splitIntoFiles(cobj);
  } else {
    var fName = Object.keys(dataObjects).join("_");
    if (args.prefix) {
      fName = args.prefix + fName;
    }
    writeFile(fName, cobj);
  }
}

var getObjectsIncludedInData = function(rootObj) {
  // Scan the data set, we only need to scan the top level
  dataObjects[rootObj[0].attributes.type] = { 
    order: 0, 
    type: rootObj[0].attributes.type,
    saveRefs: true,
    resolveRefs: false
  };
  for (var i=0;i<rootObj.length;i++) {
    var record = rootObj[i];
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

var doRefReplace = function(cObj) {
  cObj.forEach(function(obj) {
    //console.log(cObj[0].attributes.type);
    for (var key in obj) {
      if (obj[key].records) {
        // These are children
        doRefReplace(obj[key].records);
      } else {
        var fieldValue = obj[key].toString();
        var objType = obj.attributes.type;
        var reference = isReference(objType, key);
        if (reference) {
          var refTo = getReferenceTo(objType, key);
          if(dataObjects[objType].order <= dataObjects[refTo].order) {
            dataObjects[objType].order = dataObjects[refTo].order + 1;
            dataObjects[refTo].saveRefs = true;
            dataObjects[objType].resolveRefs = true;
          }
        }
        if (fieldValue.indexOf("@") !== 0) {
          if (reference) {
            var refTo = getReferenceTo(objType, key);
            var id = obj[key];
            var ref = mapOfRefObjects[refTo][id];
            obj[key] = "@" + ref;
          }
        } else {
          //delete obj[key];
        }
      }
    }
  });
  return { records: cObj };
}

var processObjectArray = function(rootObj) {
  var cObj = { records: [] };

  rootObj.forEach(function(obj) {
    var objRefId = "ref" + index++;
    var record = { attributes: {
      type: obj.attributes.type,
      referenceId: objRefId 
    }};
    
    addObjectRef(obj, objRefId);

    for (var key in obj) {
      if (key !== "attributes" && key !== "Id") {
        if (isQueryResult(obj.attributes.type, key)) {
          if (obj[key] !== null) {
            record[key] = processObjectArray(obj[key].records);
          }
        } else {
          if (obj[key] !== null) {
            if (isEmail(obj.attributes.type, key)) {
              if (validateEmail(obj[key])) {
                record[key] = obj[key];
              }
            } else {
              if (isReference(obj.attributes.type, key)) {
                // Reference to what??
                var refTo = getReferenceTo(obj.attributes.type, key);
                // Is this a reference to an object in the data???
                if (dataObjects[refTo]) {
                  // add ref to replace the value
                  var id = obj[key];
                  var refObject = mapOfRefObjects[refTo];
                  if (typeof refObject !== "undefined") {
                    var ref = mapOfRefObjects[refTo][obj[key]];
                    if (typeof ref === "undefined") {
                      record[key] = id;
                    } else {
                      record[key] = "@" + ref;
                    }
                  } else if (typeof refObject === "undefined" ) {
                    record[key] = id;
                  } else {
                    record[key] = "@refreplace";
                  }
                }
              } else {
                record[key] = obj[key];
              }
            }
          }
        }
      } else if (key === "attributes") {
        addObjectRef(obj, objRefId);
      }
    }
    
    cObj.records.push(record);
  });
  return cObj;
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



