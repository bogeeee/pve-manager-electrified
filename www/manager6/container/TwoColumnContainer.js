// This is a container intended to show a field on the first column and one on the second column.
// One can set a ratio for the field sizes.
//
// Works around a limitation of our input panel column1/2 handling that entries are not vertically
// aligned when one of them has wrapping text (like it happens sometimes with such longer
// descriptions)
Ext.define('PVE.container.TwoColumnContainer', {
    extend: 'Ext.container.Container',
    alias: 'widget.pveTwoColumnContainer',

    layout: {
        type: 'hbox',
        align: 'begin',
    },

    // The default ratio of the start widget. It an be an integer or a floating point number
    startFlex: 1,

    // The default ratio of the end widget. It an be an integer or a floating point number
    endFlex: 1,

    // the padding between the two columns
    columnPadding: 20,

    // the config of the first widget
    startColumn: undefined,

    // the config of the second widget
    endColumn: undefined,

    // same as fields in a panel
    padding: '0 0 5 0',

    initComponent: function () {
        let me = this;

        if (!me.startColumn) {
            throw 'no start widget configured';
        }
        if (!me.endColumn) {
            throw 'no end widget configured';
        }

        Ext.apply(me, {
            items: [
                Ext.applyIf({ flex: me.startFlex }, me.startColumn),
                {
                    xtype: 'box',
                    width: me.columnPadding,
                },
                Ext.applyIf({ flex: me.endFlex }, me.endColumn),
            ],
        });

        me.callParent();
    },
});
