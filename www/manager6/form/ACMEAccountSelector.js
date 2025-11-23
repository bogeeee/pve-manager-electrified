Ext.define('PVE.form.ACMEAccountSelector', {
    extend: 'Ext.form.field.ComboBox',
    alias: 'widget.pveACMEAccountSelector',

    displayField: 'name',
    valueField: 'name',

    store: {
        model: 'pve-acme-accounts',
        autoLoad: true,
    },

    triggerAction: 'all',
    queryMode: 'local',
    allowBlank: false,
    editable: false,
    forceSelection: true,

    isEmpty: function () {
        return this.getStore().getData().length === 0;
    },
});
