Ext.define('pve-acme-challenges', {
    extend: 'Ext.data.Model',
    fields: ['id', 'type', 'schema'],
    proxy: {
        type: 'proxmox',
        url: '/api2/json/cluster/acme/challenge-schema',
    },
    idProperty: 'id',
});

Ext.define('PVE.form.ACMEApiSelector', {
    extend: 'Ext.form.field.ComboBox',
    alias: 'widget.pveACMEApiSelector',

    fieldLabel: gettext('DNS API'),
    displayField: 'name',
    valueField: 'id',

    store: {
        model: 'pve-acme-challenges',
        autoLoad: true,
    },

    triggerAction: 'all',
    queryMode: 'local',
    allowBlank: false,
    editable: true,
    forceSelection: true,
    anyMatch: true,
    selectOnFocus: true,

    getSchema: function () {
        let me = this;
        let val = me.getValue();
        if (val) {
            let record = me.getStore().findRecord('id', val, 0, false, true, true);
            if (record) {
                return record.data.schema;
            }
        }
        return {};
    },
});
