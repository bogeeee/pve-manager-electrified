Ext.define('PVE.form.PermPathSelector', {
    extend: 'Ext.form.field.ComboBox',
    xtype: 'pvePermPathSelector',

    valueField: 'value',
    displayField: 'value',
    typeAhead: true,
    queryMode: 'local',
    width: 380,

    store: {
        type: 'pvePermPath',
    },
});
