Ext.define('PVE.form.FilteredKVComboBox', {
    extend: 'Proxmox.form.KVComboBox',
    alias: ['widget.pveFilteredKVComboBox'],

    // same as in the KVComboBox
    comboItems: undefined,

    // contains the allowed keys per category, e.g.
    // {
    //     category1: ['foo', 'bar'],
    //     category2: ['foo'],'
    // }
    //
    // to have an effect, the listed values must exist in the comboItems list
    allowedValuesPerCategory: {},

    // the current category. If not set, the store is not filtered.
    category: undefined,

    // If set, will be used to update the display value of the '__default__' value
    // that is usually set in a KVComboBox.
    //
    // gets the current category (if any) as parameter
    setDefaultDisplay: undefined,

    setCategory: function (category) {
        let me = this;
        me.category = category;
        me.filterByCategory(category);
    },

    filterByCategory: function (category) {
        let me = this;
        let wasValid = me.isValid();
        me.store.clearFilter();

        let allowedKeys = me.allowedValuesPerCategory[category];
        if (allowedKeys) {
            me.store.addFilter((rec) => allowedKeys.indexOf(rec.data.key) !== -1);
        }

        let isValid = me.isValid();
        // update default value with new arch
        if (Ext.isFunction(me.setDefaultDisplay)) {
            let record = me.store.findRecord('key', '__default__');
            if (record) {
                record.set('value', me.setDefaultDisplay(category));
                record.commit();
            }
        }

        // for some reason, adding/changing filters does not trigger this, even though
        // it show the field as invalid, so simply track and fire the event manually.
        if (wasValid !== isValid) {
            me.fireEvent('validitychange', me, isValid);
        }
    },

    initComponent: function () {
        var me = this;

        me.callParent();

        // initial filtering
        me.setCategory(me.category);
    },
});
